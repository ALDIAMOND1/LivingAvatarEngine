import test from 'node:test';
import assert from 'node:assert/strict';
import { ConversationState } from '../src/live/conversation-state.js';

const record = () => { const seen = []; return { seen, c: new ConversationState(s => seen.push(s)) }; };

test('ignores events until a session is connected', () => {
  const { c, seen } = record();
  c.userSpeechStart(); c.agentSpeechStart();
  assert.equal(c.state, 'off'); assert.deepEqual(seen, []);
});

test('a normal turn goes idle, listening, thinking, speaking, idle', () => {
  const { c, seen } = record();
  c.connected(); c.userSpeechStart(); c.userSpeechStop(); c.agentSpeechStart(); c.agentSpeechEnd();
  assert.deepEqual(seen, ['idle', 'listening', 'thinking', 'speaking', 'idle']);
});

test('talking over the agent is a barge-in and wins immediately', () => {
  const { c } = record();
  c.connected(); c.agentSpeechStart(); assert.equal(c.state, 'speaking');
  c.userSpeechStart();
  assert.equal(c.state, 'listening'); assert.equal(c.bargeIns, 1);
  c.agentSpeechEnd(); assert.equal(c.state, 'listening'); // tail of cut-off audio changes nothing
  c.userSpeechStop(); assert.equal(c.state, 'thinking');
});

test('agent keeps speaking if the person stops while it is still audible', () => {
  const { c } = record();
  c.connected(); c.agentSpeechStart(); c.userSpeechStart(); c.userSpeechStop();
  assert.equal(c.state, 'speaking');
});

test('short gaps in agent audio do not need provider events', () => {
  const { c, seen } = record();
  c.connected(); c.agentSpeechStart(); c.agentSpeechEnd(); c.agentSpeechStart(); c.agentSpeechEnd();
  assert.deepEqual(seen, ['idle', 'speaking', 'idle', 'speaking', 'idle']);
});

test('closing resets everything', () => {
  const { c } = record();
  c.connected(); c.userSpeechStart(); c.closed();
  assert.equal(c.state, 'off'); assert.equal(c.userTalking, false);
  c.connected(); assert.equal(c.state, 'idle');
});
