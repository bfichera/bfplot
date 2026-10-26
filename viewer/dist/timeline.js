const PLAYBACK_RATES = [0.25, 0.5, 1, 1.5, 2];
const TIME_EPSILON = 1e-9;
/**
 * Owns deterministic timeline replay and its controls.
 *
 * Seeking always starts from the immutable source document. This is deliberately
 * simple: updates are semantic replacements, so replay never depends on whatever
 * frame happened to render previously.
 */
export class TimelinePlayer {
    renderDocument;
    source;
    time = 0;
    playing = false;
    playbackRate = 1;
    playbackStarted = 0;
    playbackOrigin = 0;
    animationFrame;
    controls;
    constructor(document, renderDocument) {
        this.renderDocument = renderDocument;
        this.source = structuredClone(document);
    }
    get available() {
        return this.source.timeline !== undefined;
    }
    setDocument(document) {
        this.pause();
        this.source = structuredClone(document);
        this.time = 0;
        this.controls = undefined;
    }
    createControls() {
        const timeline = this.source.timeline;
        if (!timeline)
            return undefined;
        const controls = document.createElement("section");
        controls.className = "mplot-timeline";
        controls.setAttribute("aria-label", "Animation timeline");
        const play = this.button("Play", "play");
        play.classList.add("mplot-play");
        play.onclick = () => (this.playing ? this.pause() : this.play());
        const previous = this.button("← Frame");
        previous.onclick = () => void this.step(-1);
        const next = this.button("Frame →");
        next.onclick = () => void this.step(1);
        const range = document.createElement("input");
        range.type = "range";
        range.className = "mplot-timeline-range";
        range.min = "0";
        range.max = String(timeline.duration);
        range.step = "any";
        range.value = String(this.time);
        range.setAttribute("aria-label", "Animation time");
        range.addEventListener("input", () => {
            // Read before pause() refreshes the controls.
            const requestedTime = Number(range.value);
            this.pause();
            void this.seek(requestedTime);
        });
        const output = document.createElement("output");
        output.className = "mplot-timeline-time";
        const speed = document.createElement("select");
        speed.className = "mplot-playback-rate";
        speed.setAttribute("aria-label", "Playback speed");
        for (const rate of PLAYBACK_RATES) {
            const option = document.createElement("option");
            option.value = String(rate);
            option.textContent = `${rate}×`;
            option.selected = rate === this.playbackRate;
            speed.append(option);
        }
        speed.onchange = () => {
            const resume = this.playing;
            this.pause();
            this.playbackRate = Number(speed.value);
            if (resume)
                this.play();
        };
        controls.append(play, previous, next, range, output, speed);
        this.controls = controls;
        this.refreshControls();
        return controls;
    }
    pause() {
        this.playing = false;
        if (this.animationFrame !== undefined) {
            cancelAnimationFrame(this.animationFrame);
        }
        this.animationFrame = undefined;
        this.refreshControls();
    }
    button(label, action) {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mplot-button";
        button.textContent = label;
        if (action)
            button.dataset.action = action;
        return button;
    }
    async seek(requestedTime) {
        const timeline = this.source.timeline;
        if (!timeline)
            return;
        this.time = Math.max(0, Math.min(timeline.duration, requestedTime));
        const document = structuredClone(this.source);
        for (const frame of timeline.frames) {
            if (frame.time > this.time)
                break;
            for (const update of frame.updates)
                applyTimelineUpdate(document, update);
        }
        this.refreshControls();
        await this.renderDocument(document);
    }
    play() {
        const timeline = this.source.timeline;
        if (!timeline || this.playing || timeline.duration <= 0)
            return;
        if (this.time >= timeline.duration) {
            this.time = 0;
            void this.seek(0);
        }
        this.playing = true;
        this.playbackStarted = performance.now();
        this.playbackOrigin = this.time;
        this.refreshControls();
        const tick = (now) => {
            if (!this.playing)
                return;
            const elapsed = ((now - this.playbackStarted) / 1000) * this.playbackRate;
            const requestedTime = this.playbackOrigin + elapsed;
            if (requestedTime >= timeline.duration) {
                if (timeline.loop !== false) {
                    this.playbackStarted = now;
                    this.playbackOrigin = 0;
                    void this.seek(0);
                }
                else {
                    void this.seek(timeline.duration);
                    this.pause();
                    return;
                }
            }
            else {
                void this.seek(requestedTime);
            }
            this.animationFrame = requestAnimationFrame(tick);
        };
        this.animationFrame = requestAnimationFrame(tick);
    }
    async step(offset) {
        this.pause();
        const frameTimes = this.source.timeline?.frames.map((frame) => frame.time) ?? [];
        const times = [0, ...frameTimes];
        let current = 0;
        for (let index = 0; index < times.length; index++) {
            if (times[index] <= this.time + TIME_EPSILON)
                current = index;
        }
        const next = Math.max(0, Math.min(times.length - 1, current + offset));
        await this.seek(times[next] ?? 0);
    }
    refreshControls() {
        const timeline = this.source.timeline;
        if (!timeline || !this.controls)
            return;
        const play = this.controls.querySelector(".mplot-play");
        const range = this.controls.querySelector(".mplot-timeline-range");
        const output = this.controls.querySelector(".mplot-timeline-time");
        if (play) {
            play.textContent = this.playing ? "Pause" : "Play";
            play.setAttribute("aria-pressed", String(this.playing));
        }
        if (range)
            range.value = String(this.time);
        if (output)
            output.textContent = `${this.time.toFixed(2)} / ${timeline.duration.toFixed(2)} s`;
    }
}
export function applyTimelineUpdate(document, update) {
    const collection = update.target_kind === "artist"
        ? document.artists
        : update.target_kind === "axes"
            ? document.axes
            : document.figures;
    const target = collection.find((item) => item.id === update.target);
    if (!target || update.path.length === 0)
        return;
    let parent = target;
    for (const part of update.path.slice(0, -1)) {
        const child = parent[part];
        if (!child || typeof child !== "object" || Array.isArray(child))
            return;
        parent = child;
    }
    parent[update.path.at(-1)] = structuredClone(update.value);
}
//# sourceMappingURL=timeline.js.map