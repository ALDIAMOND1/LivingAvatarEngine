// Conversation state for the avatar: off -> idle <-> listening -> thinking -> speaking.
// Pure logic with no browser dependencies, so it is unit-tested under Node.
//
// Inputs are facts, not commands:
//   connected / closed          the voice session opened or ended
//   userSpeechStart / Stop      the person started or stopped talking
//   agentSpeechStart / End      the agent's voice became audible or fell silent
export class ConversationState {
  constructor(onChange = () => {}) {
    this.state = 'off'; this.userTalking = false; this.agentAudible = false; this.bargeIns = 0;
    this.onChange = onChange;
  }

  set(next) {
    if (next === this.state) return;
    const previous = this.state; this.state = next;
    this.onChange(next, previous);
  }

  resolve() {
    if (this.state === 'off') return;
    // The person always wins: talking over the agent is a barge-in, and the
    // avatar turns to listen even if a tail of agent audio is still playing.
    if (this.userTalking) this.set('listening');
    else if (this.agentAudible) this.set('speaking');
    else if (this.state === 'listening') this.set('thinking');
    else if (this.state === 'speaking') this.set('idle');
  }

  connected() { this.state = 'off'; this.userTalking = this.agentAudible = false; this.set('idle'); }
  closed() { this.userTalking = this.agentAudible = false; this.set('off'); }
  userSpeechStart() { if (this.agentAudible && !this.userTalking) this.bargeIns++; this.userTalking = true; this.resolve(); }
  userSpeechStop() { this.userTalking = false; this.resolve(); }
  agentSpeechStart() { this.agentAudible = true; this.resolve(); }
  agentSpeechEnd() { this.agentAudible = false; this.resolve(); }
}
