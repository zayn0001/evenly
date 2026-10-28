'use client';

import { useEffect, useRef, useState } from 'react';

const MAX_SECONDS = 60;

/** Tap to record, tap again to stop. Hands back the clip (webm on Chrome/Android, mp4 on Safari). */
export function Recorder({ onClip, busy }: { onClip: (clip: Blob) => void; busy: boolean }) {
  const [recording, setRecording] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);
  useEffect(() => {
    if (recording && seconds >= MAX_SECONDS) recorder.current?.stop();
  }, [recording, seconds]);
  useEffect(() => () => recorder.current?.stream.getTracks().forEach((t) => t.stop()), []);

  const start = async () => {
    setError(null);
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      return setError("This browser can't record audio. Type it instead.");
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch {
      return setError('Allow the microphone to say who had what, or type it instead.');
    }
    const type = ['audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => MediaRecorder.isTypeSupported(t));
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setRecording(false);
      const clip = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' });
      if (clip.size > 0) onClip(clip);
    };
    recorder.current = rec;
    rec.start();
    setSeconds(0);
    setRecording(true);
  };

  return (
    <div className="stack" style={{ gap: 6 }}>
      <button
        type="button"
        className="btn primary"
        onClick={recording ? () => recorder.current?.stop() : start}
        disabled={busy}
        aria-pressed={recording}
        style={recording ? { background: 'var(--red)', borderColor: 'var(--red)' } : undefined}
      >
        <span className={`rec-dot${recording ? ' on' : ''}`} aria-hidden />
        {busy ? 'Working it out…' : recording ? `Stop · 0:${String(seconds).padStart(2, '0')}` : 'Say who had what'}
      </button>
      {error && (
        <p className="muted" role="alert" style={{ color: 'var(--red)' }}>
          {error}
        </p>
      )}
    </div>
  );
}
