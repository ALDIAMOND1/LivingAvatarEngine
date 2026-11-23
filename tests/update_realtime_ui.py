from pathlib import Path
p=Path(r'C:\Users\aldia\Downloads\LivingAvatarEngine\index.html')
s=p.read_text(encoding='utf-8')
import re
s=s.replace('Start talking','Talk to Nia')
s=re.sub(r'<div class="capabilities">.*?</div>\s*<p class="disclosure"', '<div class="capabilities"><span>REAL CONVERSATION</span><div class="examples">Ask Nia anything. Speak naturally and interrupt her while she replies.</div></div><p class="disclosure"',s,flags=re.S)
s=re.sub(r'<p class="disclosure" id="disclosure">.*?</p>','<p class="disclosure" id="disclosure">Realtime conversation requires an API key and incurs provider charges. Nia uses locally rendered photographic assets. Accurate lip sync and 3D head motion are not yet implemented.</p>',s,flags=re.S)
s=re.sub(r'<p id="heard">.*?</p>','<p id="heard">Your words will appear here when transcription is available.</p>',s,flags=re.S)
s=re.sub(r'<div class="voice-note">.*?</div>','<div class="voice-note">Grant microphone access once, then speak naturally. You can interrupt Nia while she replies.</div>',s,flags=re.S)
s=s.replace('VOICE FIRST · NO MOTION BUTTONS','REALTIME VOICE · INTERRUPTIBLE CONVERSATION')
p.write_text(s,encoding='utf-8')
print('Updated Nia voice-first page')
