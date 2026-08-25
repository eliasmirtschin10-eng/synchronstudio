import React from 'react';
import { X, HelpCircle, AlertTriangle, CheckCircle2, FileCode, Volume2 } from 'lucide-react';

interface GuidelinesModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const GuidelinesModal: React.FC<GuidelinesModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-xl overflow-hidden text-xs">
        {/* Header */}
        <div className="bg-zinc-950 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HelpCircle className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-zinc-100">
              The Choicer Voicer - Mod Maker Guidelines & Best Practices
            </h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-200 p-1 cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4 max-h-[75vh] overflow-y-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          {/* Section 1: Audio Quality & In-Game Scoring */}
          <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-2">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
              <Volume2 className="w-4 h-4" />
              1. Voice Audio & Waveform Scoring
            </h3>
            <ul className="space-y-1.5 text-zinc-300 list-disc list-inside">
              <li>
                <strong>Clear & Loud Audio:</strong> Ensure voice clip audio is clear and normalized so players can match vocal waveforms during in-game dub scoring.
              </li>
              <li>
                <strong>Remove Voice from Backing Track:</strong> Always strip voice audio from <code className="text-amber-300">_backing_track.wav</code> so the game algorithms sample voice input cleanly without acoustic interference.
              </li>
              <li>
                <strong>Individual Clip Files:</strong> Each spoken voice line is exported as an isolated WAV file (e.g. <code className="text-amber-300">01_buzz.wav</code>) accompanied by its respective INI file.
              </li>
            </ul>
          </div>

          {/* Section 2: Dub Timestamps & Sync */}
          <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-2">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
              <CheckCircle2 className="w-4 h-4" />
              2. Dub Timestamps Precision
            </h3>
            <ul className="space-y-1.5 text-zinc-300 list-disc list-inside">
              <li>
                <strong>Millisecond Precision:</strong> Timestamps in <code className="text-amber-300">dub_timestamps=[05.865]</code> represent the exact second mark where the character starts speaking in the video sequence.
              </li>
              <li>
                Use the inspector&apos;s fine-tuner buttons or auto-detect gaps feature to align timestamps accurately with mouth movements.
              </li>
            </ul>
          </div>

          {/* Section 3: Modpack Directory Structure */}
          <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-2">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
              <FileCode className="w-4 h-4" />
              3. Required Archive & File Structure
            </h3>
            <pre className="bg-zinc-900 p-2.5 rounded font-sans text-[11px] text-zinc-300 border border-zinc-800 overflow-x-auto leading-relaxed">
{`Woody_and_Buzz_Dub_Pack.zip
├── _pack_info.ini
├── dub_video.mp4
├── _backing_track.wav
├── buzz_avatar.png
├── woody_avatar.png
├── 01_buzz.wav
├── 01_buzz.ini
├── 02_woody.wav
├── 02_woody.ini
└── _draft_project.json (Optional)`}
            </pre>
            <p className="text-zinc-400 text-[11px] mt-1">
              Character avatars automatically format as <code className="text-amber-300">character_name_avatar.ext</code> in exports. When reopening projects, original filenames are preserved for easy reference.
            </p>
          </div>

          {/* Section 4: INI Formatting Rules */}
          <div className="bg-amber-500/10 border border-zinc-800 p-3 rounded text-amber-200/90 leading-relaxed">
            <div className="flex items-center gap-1.5 font-bold mb-1 text-amber-300">
              <AlertTriangle className="w-4 h-4" />
              <span>Smart Quotes & INI Syntax</span>
            </div>
            <p className="text-[11px]">
              Captions support curly/smart quotes e.g. <code className="text-white">“According to my nava-computer...”</code>. The Choicer Voicer Mod Maker automatically handles escaping double quotes and formatting arrays like <code className="text-white">authors=[&quot;Name&quot;]</code> and <code className="text-white">dub_characters=[&quot;Buzz&quot;]</code>.
            </p>
          </div>

          {/* Section 5: Choicer Voicer Draft Files (.cvmmd) & Compatibility */}
          <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-2">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
              <FileCode className="w-4 h-4" />
              5. Choicer Voicer Draft Files (.cvmmd) & Re-linking
            </h3>
            <p className="text-zinc-300 text-[11px] leading-relaxed">
              The <code className="text-amber-300">.cvmmd</code> file is a custom <strong>Choicer Voicer Mod Maker Draft</strong> format (written in JSON) that acts as a secure, ultra-lightweight project snapshot.
            </p>
            <ul className="space-y-1.5 text-zinc-400 text-[11px] list-disc list-inside leading-relaxed">
              <li>
                <strong>What it saves:</strong> It stores your entire timeline state, including clip durations, volume offsets, character labels, subtitles, and metadata settings.
              </li>
              <li>
                <strong>Instant Backups:</strong> Use <code className="text-amber-300">.cvmmd</code> to quickly save and backup progress without packaging massive video/audio media files into a ZIP during active editing.
              </li>
              <li>
                <strong>The Re-linking Dialog:</strong> When dragging a <code className="text-amber-300">.cvmmd</code> draft into the app, modern browser security constraints prevent reading files from your machine automatically. The app will trigger an <strong>Upload Project Files</strong> modal.
              </li>
              <li>
                <strong>Asset Binding:</strong> Re-upload your original <code className="text-amber-300">.mp4</code> video, backing track audio, and character avatars in the prompt. The app only accepts fully compatible file extensions to prevent playback failures.
              </li>
              <li>
                <strong>ZIP Archives:</strong> Exported ZIP modpacks contain a companion <code className="text-amber-300">_draft_project.json</code> representing this draft state, allowing direct import of the whole ZIP back into the editor later.
              </li>
            </ul>
          </div>

          {/* Section 6: Video Conversion & Best Practices */}
          <div className="bg-zinc-950 p-3 rounded border border-zinc-800 space-y-2">
            <h3 className="font-bold text-amber-400 flex items-center gap-1.5 text-xs">
              <FileCode className="w-4 h-4" />
              6. Video Encoding & Format Compatibility
            </h3>
            <ul className="space-y-1.5 text-zinc-300 text-[11px] list-disc list-inside leading-relaxed">
              <li>
                <strong>Recommended Source Video:</strong> For the most stable conversion, always upload a standard MP4 file (<code className="text-amber-300">H.264</code>) as your source video. It is highly recommended to use common framerates (24, 30, 60fps) and standard resolutions (like 1280x720 or 1920x1080). Ensure your video has an audio track, even if it's silent.
              </li>
              <li>
                <strong>Video handling:</strong> Your MP4 is packed as <code className="text-amber-300">dub_video.mp4</code>. If it is already 720p or smaller, it is copied straight into the ZIP and the export takes seconds. Taller videos are scaled down to 720p in your browser, which needs a little more time on long clips.
              </li>
              <li>
                <strong>Automatic Fallback:</strong> If scaling fails or runs out of memory, your original MP4 is packed unchanged instead of dropping it — Synchronstudio plays MP4 at any resolution.
              </li>
            </ul>
          </div>
        </div>

        {/* Footer */}
        <div className="bg-zinc-950 p-3 border-t border-zinc-800 text-right">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded bg-[#d97706] hover:bg-[#f59e0b] text-white font-bold transition-colors cursor-pointer border-none"
          >
            Got it!
          </button>
        </div>
      </div>
    </div>
  );
};

