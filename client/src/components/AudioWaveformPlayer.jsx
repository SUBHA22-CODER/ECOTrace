import React, { useState, useEffect, useRef } from 'react';
import { Play, Pause, Volume2, VolumeX, RotateCcw, FastForward, Radio } from 'lucide-react';

export default function AudioWaveformPlayer({ call, currentTurnIndex = 0, onSeekTurn }) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackTime, setPlaybackTime] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const [isMuted, setIsMuted] = useState(false);
  const [currentSpeaker, setCurrentSpeaker] = useState('agent');
  const [isAudioActive, setIsAudioActive] = useState(false);

  const duration = call?.duration_sec || 60;
  const transcript = call?.transcript || [];

  const turnIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const synthRef = useRef(typeof window !== 'undefined' ? window.speechSynthesis : null);
  const audioCtxRef = useRef(null);

  // Static clean waveform bars based on speech frequency profile
  const [bars] = useState(() => {
    return Array.from({ length: 48 }, (_, i) => {
      const base = Math.sin(i * 0.4) * 14 + Math.cos(i * 0.8) * 9 + 18;
      return Math.max(8, Math.min(32, Math.round(base)));
    });
  });

  // Keep ref synchronized
  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Handle external turn selection from transcript click
  useEffect(() => {
    if (typeof currentTurnIndex === 'number' && currentTurnIndex !== turnIndexRef.current) {
      turnIndexRef.current = currentTurnIndex;
      const turn = transcript[currentTurnIndex];
      if (turn && typeof turn.timestamp_offset === 'number') {
        setPlaybackTime(turn.timestamp_offset);
      }
      if (isPlaying) {
        speakTurn(currentTurnIndex);
      }
    }
  }, [currentTurnIndex]);

  // Play gentle subtle audio tone using AudioContext
  const playChime = (freq = 440, type = 'sine') => {
    try {
      if (!audioCtxRef.current) {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) audioCtxRef.current = new AudioContext();
      }
      if (audioCtxRef.current && audioCtxRef.current.state === 'suspended') {
        audioCtxRef.current.resume();
      }
      if (audioCtxRef.current && !isMuted) {
        const osc = audioCtxRef.current.createOscillator();
        const gain = audioCtxRef.current.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtxRef.current.currentTime);
        gain.gain.setValueAtTime(0.08, audioCtxRef.current.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.0001, audioCtxRef.current.currentTime + 0.25);
        osc.connect(gain);
        gain.connect(audioCtxRef.current.destination);
        osc.start();
        osc.stop(audioCtxRef.current.currentTime + 0.25);
      }
    } catch {
      // AudioContext unavailable or restricted
    }
  };

  // Speak a specific turn using browser speech synthesis
  const speakTurn = (index) => {
    if (!synthRef.current || index >= transcript.length) {
      setIsPlaying(false);
      setIsAudioActive(false);
      return;
    }

    synthRef.current.cancel();

    const turn = transcript[index];
    if (!turn || !turn.text) {
      if (index + 1 < transcript.length && isPlayingRef.current) {
        speakTurn(index + 1);
      }
      return;
    }

    turnIndexRef.current = index;
    onSeekTurn && onSeekTurn(index);
    setCurrentSpeaker(turn.speaker);
    setIsAudioActive(true);

    if (typeof turn.timestamp_offset === 'number') {
      setPlaybackTime(turn.timestamp_offset);
    }

    const utterance = new SpeechSynthesisUtterance(turn.text);
    utterance.rate = playbackSpeed;
    utterance.volume = isMuted ? 0 : 1;

    // Pick voices based on speaker role
    const voices = synthRef.current.getVoices();
    if (voices && voices.length > 0) {
      if (turn.speaker === 'agent') {
        utterance.pitch = 1.05;
        const englishVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Samantha')));
        if (englishVoice) utterance.voice = englishVoice;
      } else {
        utterance.pitch = 0.95;
        const userVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('David') || v.name.includes('George') || v.name.includes('Alex')));
        if (userVoice) utterance.voice = userVoice;
      }
    }

    playChime(turn.speaker === 'agent' ? 520 : 380);

    utterance.onend = () => {
      if (isPlayingRef.current) {
        const nextIdx = index + 1;
        if (nextIdx < transcript.length) {
          setTimeout(() => {
            if (isPlayingRef.current) {
              speakTurn(nextIdx);
            }
          }, 350);
        } else {
          setIsPlaying(false);
          setIsAudioActive(false);
          setPlaybackTime(duration);
        }
      } else {
        setIsAudioActive(false);
      }
    };

    utterance.onerror = () => {
      setIsAudioActive(false);
      if (isPlayingRef.current && index + 1 < transcript.length) {
        speakTurn(index + 1);
      }
    };

    synthRef.current.speak(utterance);
  };

  const handleTogglePlay = () => {
    if (isPlaying) {
      if (synthRef.current) synthRef.current.cancel();
      setIsPlaying(false);
      setIsAudioActive(false);
    } else {
      setIsPlaying(true);
      playChime(440, 'triangle');
      speakTurn(turnIndexRef.current);
    }
  };

  const handleSpeedChange = (speed) => {
    setPlaybackSpeed(speed);
    if (isPlaying) {
      speakTurn(turnIndexRef.current);
    }
  };

  const handleToggleMute = () => {
    const nextMute = !isMuted;
    setIsMuted(nextMute);
    if (synthRef.current && isPlaying) {
      speakTurn(turnIndexRef.current);
    }
  };

  const handleBarClick = (index) => {
    const targetTurn = Math.min(
      transcript.length - 1,
      Math.floor((index / bars.length) * transcript.length)
    );
    turnIndexRef.current = targetTurn;
    onSeekTurn && onSeekTurn(targetTurn);

    const turn = transcript[targetTurn];
    if (turn && typeof turn.timestamp_offset === 'number') {
      setPlaybackTime(turn.timestamp_offset);
    }

    if (isPlaying) {
      speakTurn(targetTurn);
    }
  };

  const formatTime = (secs) => {
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const progressPercent = Math.min(100, (playbackTime / duration) * 100);

  return (
    <div className="eleven-card p-4 bg-white border border-black/[0.08] rounded-2xl shadow-sm">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3 pb-3 border-b border-black/[0.06]">

        {/* Playback Controls & Status */}
        <div className="flex items-center gap-3">
          <button
            onClick={handleTogglePlay}
            className="w-11 h-11 rounded-full flex items-center justify-center transition-all cursor-pointer shadow-md bg-black text-white hover:bg-[#23252A] active:scale-95"
            title={isPlaying ? 'Pause Audio' : 'Play ElevenLabs Voice Stream'}
          >
            {isPlaying ? (
              <Pause className="w-5 h-5 fill-white" />
            ) : (
              <Play className="w-5 h-5 fill-white ml-0.5" />
            )}
          </button>

          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#0B0C0E]">ElevenLabs Speech Stream</span>
              <span className="eleven-pill text-[10px] py-0.5 px-2 border font-bold bg-black/[0.05] text-[#0B0C0E] border-black/[0.1]">
                {isAudioActive ? `SPEAKING: ${currentSpeaker.toUpperCase()}` : 'HD AUDIO READY'}
              </span>
            </div>
            <div className="text-[11px] font-mono text-[#45433E] mt-0.5 flex items-center gap-2 font-medium">
              <span>{formatTime(playbackTime)}</span> / <span>{formatTime(duration)}</span>
              <span>•</span>
              <span className="text-[#0B0C0E] font-bold">Turn {turnIndexRef.current + 1} of {transcript.length}</span>
            </div>
          </div>
        </div>

        {/* Speed & Volume buttons */}
        <div className="flex items-center gap-2 self-end sm:self-auto">
          {/* Speed Selector */}
          <div className="flex items-center bg-black/[0.05] p-0.5 rounded-lg border border-black/[0.1] text-[11px] font-mono">
            {[1.0, 1.25, 1.5].map((speed) => (
              <button
                key={speed}
                onClick={() => handleSpeedChange(speed)}
                className={`px-2 py-0.5 rounded transition-all cursor-pointer ${
                  playbackSpeed === speed ? 'bg-black text-white font-bold' : 'text-[#3D3B36] hover:text-[#0B0C0E]'
                }`}
              >
                {speed}x
              </button>
            ))}
          </div>

          <button
            onClick={handleToggleMute}
            className={`w-8 h-8 rounded-lg flex items-center justify-center border border-black/[0.1] cursor-pointer transition-all ${
              isMuted ? 'bg-rose-100 text-rose-800' : 'bg-black/[0.04] text-[#3D3B36] hover:text-[#0B0C0E]'
            }`}
            title={isMuted ? 'Unmute Sound' : 'Mute Sound'}
          >
            {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
          </button>
        </div>

      </div>

      {/* Clean Monochrome Sound Waveform Scrubber */}
      <div className="relative pt-2 pb-1">
        <div className="flex items-center justify-between gap-1 h-10 px-1 cursor-pointer">
          {bars.map((height, i) => {
            const barPercent = (i / bars.length) * 100;
            const isPassed = barPercent <= progressPercent;

            return (
              <div
                key={i}
                onClick={() => handleBarClick(i)}
                className="flex-1 flex items-center justify-center h-full group"
                title={`Seek to ~${Math.round((i / bars.length) * duration)}s`}
              >
                <div
                  className={`w-full max-w-[3px] rounded-full transition-all duration-150 ${
                    isPassed
                      ? 'bg-black'
                      : 'bg-black/15 group-hover:bg-black/30'
                  }`}
                  style={{
                    height: `${height}px`
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Scrub Progress Bar (Solid Monochrome) */}
        <div className="w-full bg-black/[0.08] h-1.5 rounded-full mt-2 overflow-hidden relative cursor-pointer">
          <div
            className="bg-black h-full rounded-full transition-all duration-150"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

    </div>
  );
}
