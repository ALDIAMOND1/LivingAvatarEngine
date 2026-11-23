// Hands the raw sound passing through to the page, block by block. With nothing
// connected it hands over silence, so the stream never stops.
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0]?.[0];
    this.port.postMessage(ch ? ch.slice(0) : new Float32Array(128));
    return true;
  }
}
registerProcessor('pcm-tap', PcmTap);
