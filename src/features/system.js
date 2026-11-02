// System (23, 24) and Power (25) pages. Sampled once a second only while one of them is visible;
// the one-minute history starts empty each time a page opens. Reads /proc and /sys; GPU is best effort.
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Graphene from 'gi://Graphene';
import St from 'gi://St';
import * as S from '../lib/stats.js';

const HISTORY = 60; // samples, one a second
const APPS = 4;
const MAX_DRIVES = 2;
const RAPL = '/sys/class/powercap';
const DISCHARGING = 2; // UPower State

// ponytail: sync reads of /proc and /sys (kernel-generated, fast); ~400 small reads every 2 s for top
// apps. Move to async Gio reads if it ever shows up in a shell profile.
const read = path => {
    try {
        return new TextDecoder().decode(GLib.file_get_contents(path)[1]);
    } catch {
        return null; // missing, gone (exited pid) or root-only
    }
};
const readNum = path => {
    const t = read(path);
    return t === null || t.trim() === '' ? null : Number(t);
};
function listDir(path) {
    const out = [];
    try {
        const dir = GLib.Dir.open(path, 0);
        for (let n; (n = dir.read_name());)
            out.push(n);
        dir.close();
    } catch {}
    return out;
}

const fmtRate = b => (b < 1000 ? `${Math.round(b)} B/s` : `${GLib.format_size(b)}/s`);
const pct = f => `${Math.round(f * 100)}%`;

// A stat card: caption, value and a level bar (the fill is scaled, so no relayout per sample).
function card(caption) {
    const value = new St.Label({style_class: 'revelio-card-value'});
    const fill = new St.Widget({style_class: 'revelio-card-fill', x_expand: true, pivot_point: new Graphene.Point({x: 0, y: 0})});
    const track = new St.Widget({style_class: 'revelio-card-track', layout_manager: new Clutter.BinLayout(), x_expand: true});
    track.add_child(fill);
    const box = new St.BoxLayout({style_class: 'revelio-card', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
    box.add_child(new St.Label({style_class: 'revelio-card-caption', text: caption}));
    box.add_child(value);
    box.add_child(track);
    return {box, value, set(text, level) {
        value.text = text;
        fill.scale_x = Math.max(0, Math.min(1, level ?? 0));
    }};
}

// Key/value rows, rebuilt only when the number of rows changes.
function setRows(box, rows) {
    if (box.get_n_children() !== rows.length) {
        box.destroy_all_children();
        for (let i = 0; i < rows.length; i++) {
            const row = new St.BoxLayout({style_class: 'revelio-kv'});
            row.add_child(new St.Label({style_class: 'revelio-kv-key', x_expand: true}));
            row.add_child(new St.Label({style_class: 'revelio-kv-value'}));
            box.add_child(row);
        }
    }
    box.get_children().forEach((row, i) => {
        const [k, v] = /** @type {St.Label[]} */ (row.get_children());
        [k.text, v.text] = rows[i];
    });
}

const column = (caption, child, cls = '') => {
    const box = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: `revelio-sys-col ${cls}`,
        x_expand: cls === 'revelio-sys-apps'});
    box.add_child(new St.Label({style_class: 'revelio-caption', text: caption}));
    box.add_child(child);
    return box;
};
const watts = w => `${w < 10 ? w.toFixed(1) : Math.round(w)} W`;

// First GPU by preference (discrete NVIDIA, then AMD, then Intel). APUs report the whole SoC as PPT.
function findGpu() {
    const gpus = [];
    for (const card of listDir('/sys/class/drm').filter(n => /^card\d+$/.test(n))) {
        const dev = `/sys/class/drm/${card}/device`;
        const vendor = read(`${dev}/vendor`)?.trim();
        const hw = listDir(`${dev}/hwmon`)[0];
        const hwmon = hw ? `${dev}/hwmon/${hw}` : null;
        if (vendor === '0x10de')
            gpus.push({rank: 0, kind: 'nvidia', smi: GLib.find_program_in_path('nvidia-smi')});
        else if (vendor === '0x1002')
            gpus.push({rank: 1, kind: 'amd', dev, hwmon, apu: read(`${hwmon}/power1_label`)?.trim() === 'PPT'});
        else if (vendor === '0x8086')
            gpus.push({rank: 2, kind: 'intel', hwmon});
    }
    const gpu = gpus.sort((a, b) => a.rank - b.rank)[0] ?? null;
    return gpu?.kind === 'nvidia' && !gpu.smi ? null : gpu;
}

export class System {
    constructor(island, settings, battery) {
        this._island = island;
        this._settings = settings;
        this._battery = battery; // its UPower proxy arrives asynchronously
        this._timerId = 0;
        this._cancellable = new Gio.Cancellable();
        this._gpu = findGpu();
        this._gpuNow = {load: null, temp: null, power: null};
        // RAPL packages (CPU) and psys (whole platform, some Intel laptops).
        this._rapl = listDir(RAPL).filter(n => /^intel-rapl:\d+$/.test(n)).map(n => ({
            path: `${RAPL}/${n}/energy_uj`,
            max: readNum(`${RAPL}/${n}/max_energy_range_uj`) ?? 2 ** 32,
            psys: read(`${RAPL}/${n}/name`)?.trim() === 'psys',
        }));

        // System page: stat cards on top; details, CPU history with per-core load, and top apps below.
        this._cards = {cpu: card('CPU'), gpu: card('GPU'), mem: card('Memory'), disk: card('Drives'),
            net: card('Network'), bat: card('Battery')};
        this._cards.gpu.box.visible = !!this._gpu;
        const cards = new St.BoxLayout({style_class: 'revelio-cards', x_expand: true});
        Object.values(this._cards).forEach(c => cards.add_child(c.box));
        this._details = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        this._graph = new St.DrawingArea({style_class: 'revelio-graph', y_expand: true});
        this._graph.connect('repaint', area => this._paintGraph(area));
        this._apps = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL});
        const bottom = new St.BoxLayout({style_class: 'revelio-sys-bottom', x_expand: true, y_expand: true});
        bottom.add_child(column('DETAILS', this._details, 'revelio-sys-details'));
        bottom.add_child(column('CPU HISTORY · PER CORE', this._graph, 'revelio-sys-graph'));
        bottom.add_child(column('TOP APPS', this._apps, 'revelio-sys-apps'));
        this._sysPage = new St.BoxLayout({style_class: 'revelio-system-page', orientation: Clutter.Orientation.VERTICAL, x_expand: true});
        this._sysPage.add_child(cards);
        this._sysPage.add_child(bottom);

        // Power page: total on the left, CPU / GPU / other cards (share of the total) on the right.
        this._total = new St.Label({style_class: 'revelio-power-total'});
        this._totalNote = new St.Label({style_class: 'revelio-dim revelio-small'});
        const left = new St.BoxLayout({orientation: Clutter.Orientation.VERTICAL, style_class: 'revelio-power-left',
            y_align: Clutter.ActorAlign.CENTER});
        left.add_child(new St.Label({style_class: 'revelio-caption', text: 'POWER DRAW'}));
        left.add_child(this._total);
        left.add_child(this._totalNote);
        this._parts = {cpu: card(this._gpu?.apu ? 'CPU+GPU' : 'CPU'), gpu: card('GPU'), other: card('Everything else')};
        this._parts.gpu.box.visible = !this._gpu?.apu;
        const parts = new St.BoxLayout({style_class: 'revelio-cards', x_expand: true, y_align: Clutter.ActorAlign.CENTER});
        Object.values(this._parts).forEach(c => parts.add_child(c.box));
        this._powerPage = new St.BoxLayout({style_class: 'revelio-system-page revelio-power-page', x_expand: true});
        this._powerPage.add_child(left);
        this._powerPage.add_child(parts);

        for (const page of [this._sysPage, this._powerPage])
            page.connectObject('notify::mapped', () => this._syncTimer(), this);
        island.addPage(this._sysPage, 'System', 'power-profile-balanced-symbolic');
        island.addPage(this._powerPage, 'Power', 'battery-full-charged-symbolic');
    }

    _syncTimer() {
        const on = this._sysPage.mapped || this._powerPage.mapped;
        if (on && !this._timerId) {
            this._prev = null;
            this._procs = null;
            this._history = [];
            this._cores = [];
            this._tick = 0;
            this._drives = this._readDrives(); // changes slowly: once per opening
            this._sample();
            this._timerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._sample();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!on && this._timerId) {
            GLib.source_remove(this._timerId);
            this._timerId = 0;
        }
    }

    _readDrives() {
        const seen = new Set(), out = [];
        for (const line of (read('/proc/mounts') ?? '').split('\n')) {
            const [dev, mnt] = line.split(' ');
            if (!dev?.startsWith('/dev/') || dev.startsWith('/dev/loop') || seen.has(dev) || /^\/(boot|snap)(\/|$)/.test(mnt))
                continue;
            seen.add(dev);
            const path = mnt.replace(/\\(\d{3})/g, (_m, o) => String.fromCharCode(parseInt(o, 8)));
            try {
                const info = Gio.File.new_for_path(path).query_filesystem_info('filesystem::size,filesystem::free', null);
                const size = info.get_attribute_uint64('filesystem::size');
                if (size > 0)
                    out.push({name: path === '/' ? '/' : GLib.path_get_basename(path), size, used: size - info.get_attribute_uint64('filesystem::free')});
            } catch {}
        }
        return out.slice(0, MAX_DRIVES);
    }

    _sample() {
        const time = GLib.get_monotonic_time() / 1000, prev = this._prev, dt = prev ? time - prev.time : 0;
        const cpu = S.parseCpu(read('/proc/stat') ?? '');
        const net = S.parseNetDev(read('/proc/net/dev') ?? '');
        const mem = S.parseMeminfo(read('/proc/meminfo') ?? '');
        const energy = this._rapl.map(z => readNum(z.path));
        const load = prev ? S.cpuLoad(prev.cpu, cpu) : cpu.map(() => 0);
        this._prev = {time, cpu, net, energy};
        if (prev) {
            this._history.push(load[0]);
            if (this._history.length > HISTORY)
                this._history.shift();
        }
        this._cores = load.slice(1);

        const slow = this._tick++ % 2 === 0; // top apps and nvidia-smi every 2 s
        if (slow && this._sysPage.mapped)
            this._sampleApps(cpu[0]?.total ?? 0);
        this._sampleGpu(slow);

        const c = this._cards, used = mem.total - mem.available;
        c.cpu.set(pct(load[0] ?? 0), load[0]);
        c.mem.set(pct(mem.total ? used / mem.total : 0), mem.total ? used / mem.total : 0);
        const d = this._drives[0];
        c.disk.box.visible = !!d;
        if (d)
            c.disk.set(pct(d.used / d.size), d.used / d.size);
        const rx = prev ? S.rate(prev.net.rx, net.rx, dt) : 0, tx = prev ? S.rate(prev.net.tx, net.tx, dt) : 0;
        c.net.set(fmtRate(rx + tx), Math.log10(1 + rx + tx) / 8); // log scale, 100 MB/s full
        const g = this._gpuNow;
        if (this._gpu)
            c.gpu.set(g.load === null ? 'N/A' : pct(g.load), g.load);
        const bat = this._battery.proxy;
        c.bat.box.visible = !!bat?.IsPresent;
        if (bat?.IsPresent)
            c.bat.set(`${Math.round(bat.Percentage)}%`, bat.Percentage / 100);

        const rows = [['Memory', `${GLib.format_size(used)} / ${GLib.format_size(mem.total)}`]];
        for (const drive of this._drives)
            rows.push([`Disk ${drive.name}`, `${GLib.format_size(drive.used)} / ${GLib.format_size(drive.size)}`]);
        rows.push(['Down · Up', `${fmtRate(rx)} · ${fmtRate(tx)}`]);
        if (this._gpu && g.temp !== null)
            rows.push(['GPU temp', `${Math.round(g.temp)} °C`]);
        if (bat?.IsPresent)
            rows.push(['Battery', bat.State === DISCHARGING ? 'On battery' : 'Plugged in']);
        setRows(this._details, rows);
        this._graph.queue_repaint();

        this._samplePower(prev, energy, dt, load[0] ?? 0);
    }

    _sampleApps(total) {
        const procs = new Map();
        for (const pid of listDir('/proc')) {
            if (!/^\d+$/.test(pid))
                continue;
            const t = read(`/proc/${pid}/stat`);
            if (t)
                procs.set(pid, S.parseProcStat(t));
        }
        const prev = this._procs;
        this._procs = {procs, total};
        const top = prev ? S.topApps(prev.procs, procs, total - prev.total, APPS) : [];
        setRows(this._apps, top.length ? top.map(a => [a.name, pct(a.share)]) : [['Measuring…', '']]);
    }

    _sampleGpu(slow) {
        const gpu = this._gpu;
        if (!gpu)
            return;
        if (gpu.kind === 'nvidia') {
            if (slow)
                this._runSmi();
            return;
        }
        const hw = gpu.hwmon;
        const temp = hw ? readNum(`${hw}/temp1_input`) : null;
        const busy = gpu.kind === 'amd' ? readNum(`${gpu.dev}/gpu_busy_percent`) : null;
        const power = hw ? readNum(`${hw}/power1_average`) ?? readNum(`${hw}/power1_input`) : null;
        this._gpuNow = {load: busy === null ? null : busy / 100, temp: temp === null ? null : temp / 1000,
            power: power === null ? null : power / 1e6};
    }

    _runSmi() {
        if (this._smiBusy)
            return;
        let proc;
        try {
            proc = Gio.Subprocess.new([this._gpu.smi, '--query-gpu=utilization.gpu,temperature.gpu,power.draw',
                '--format=csv,noheader,nounits'], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (e) {
            logError(e, 'Revelio: nvidia-smi');
            this._gpu = null;
            return;
        }
        this._smiBusy = true;
        proc.communicate_utf8_async(null, this._cancellable, (_p, res) => {
            this._smiBusy = false;
            try {
                const [, out] = proc.communicate_utf8_finish(res);
                const [u, t, w] = out.split('\n')[0].split(',').map(s => Number.parseFloat(s));
                this._gpuNow = {load: Number.isNaN(u) ? null : u / 100, temp: Number.isNaN(t) ? null : t, power: Number.isNaN(w) ? null : w};
            } catch {} // cancelled on disable, or the driver went away
        });
    }

    // CPU: RAPL, else the APU's PPT (CPU and GPU together), else load × TDP. Total: battery discharge
    // rate or RAPL psys when there is one; otherwise CPU + GPU + a fixed estimate for the rest.
    _samplePower(prev, energy, dt, load) {
        const fromRapl = (want) => {
            if (!prev || dt <= 0)
                return null;
            let uj = 0, any = false;
            this._rapl.forEach((z, i) => {
                if (z.psys !== want || energy[i] === null || prev.energy[i] === null)
                    return;
                uj += S.wrapDelta(prev.energy[i], energy[i], z.max);
                any = true;
            });
            return any ? uj / dt / 1000 : null; // µJ per ms = mW
        };
        const apu = this._gpu?.apu;
        let cpu = fromRapl(false), cpuMeasured = cpu !== null;
        if (cpu === null && apu && this._gpuNow.power !== null)
            [cpu, cpuMeasured] = [this._gpuNow.power, true];
        cpu ??= load * this._settings.get_uint('power-tdp');
        const gpu = apu ? null : this._gpuNow.power;

        const bat = this._battery.proxy;
        let total = bat?.IsPresent && bat.State === DISCHARGING && bat.EnergyRate > 0 ? bat.EnergyRate : fromRapl(true);
        const totalMeasured = total !== null;
        const other = totalMeasured ? Math.max(0, total - cpu - (gpu ?? 0)) : this._settings.get_uint('power-base');
        total ??= cpu + (gpu ?? 0) + other;

        const est = measured => (measured ? '' : '~');
        this._total.text = `${est(totalMeasured)}${watts(total)}`;
        this._totalNote.text = totalMeasured ? 'measured' : '~ estimated';
        const share = w => (total > 0 ? w / total : 0);
        this._parts.cpu.set(`${est(cpuMeasured)}${watts(cpu)}`, share(cpu));
        this._parts.gpu.set(gpu === null ? 'N/A' : watts(gpu), share(gpu ?? 0));
        this._parts.other.set(`${est(totalMeasured)}${watts(other)}`, share(other));
    }

    _paintGraph(area) {
        const cr = area.get_context();
        const [w, h] = area.get_surface_size();
        const coreH = Math.round(h * 0.3), histH = h - coreH - 3;
        cr.setSourceRGBA(1, 1, 1, 0.08);
        cr.rectangle(0, 0, w, histH);
        cr.fill();
        const hist = this._history ?? [], step = w / (HISTORY - 1);
        if (hist.length > 1) {
            const x = i => w - (hist.length - 1 - i) * step;
            cr.moveTo(x(0), histH);
            hist.forEach((v, i) => cr.lineTo(x(i), histH * (1 - v)));
            cr.lineTo(w, histH);
            cr.closePath();
            cr.setSourceRGBA(0.47, 0.68, 0.93, 0.6);
            cr.fill();
        }
        const cores = this._cores ?? [], bw = cores.length ? w / cores.length : 0;
        cores.forEach((v, i) => {
            cr.setSourceRGBA(1, 1, 1, 0.12);
            cr.rectangle(i * bw + 1, histH + 3, bw - 2, coreH);
            cr.fill();
            cr.setSourceRGBA(0.47, 0.68, 0.93, 1);
            cr.rectangle(i * bw + 1, h - coreH * v, bw - 2, coreH * v);
            cr.fill();
        });
        cr.$dispose();
    }

    destroy() {
        if (this._timerId)
            GLib.source_remove(this._timerId);
        this._timerId = 0;
        this._cancellable.cancel();
        for (const page of [this._sysPage, this._powerPage]) {
            page.disconnectObject(this);
            this._island.removePage(page);
            page.destroy();
        }
    }
}
