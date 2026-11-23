// Loudness of an audio node as 0..1 (RMS, scaled so normal speech sits around 0.2-0.5).
export class LevelMeter {
  constructor(ctx, node) {
    this.analyser = new AnalyserNode(ctx, { fftSize: 512 });
    this.buffer = new Float32Array(this.analyser.fftSize);
    this.node = node; node.connect(this.analyser);
  }
  read() {
    this.analyser.getFloatTimeDomainData(this.buffer);
    let sum = 0; for (const x of this.buffer) sum += x * x;
    return Math.min(1, Math.sqrt(sum / this.buffer.length) * 4);
  }
  close() { try { this.node.disconnect(this.analyser); } catch { /* already gone */ } }
}
