import React, { useState, useEffect } from 'react';
import { X, Save, FileText, Check } from 'lucide-react';
import { Character, PackInfo } from '../types';

interface PackMetadataModalProps {
  isOpen: boolean;
  packInfo: PackInfo;
  characters: Character[];
  onClose: () => void;
  onSave: (updatedInfo: PackInfo) => void;
}

export const PackMetadataModal: React.FC<PackMetadataModalProps> = ({
  isOpen,
  packInfo,
  characters,
  onClose,
  onSave,
}) => {
  const [title, setTitle] = useState(packInfo.title);
  const [sceneId, setSceneId] = useState(packInfo.sceneId || '');
  const [authorsStr, setAuthorsStr] = useState(packInfo.authors.join(', '));
  const [readme, setReadme] = useState(packInfo.readme);
  const [iconFilename, setIconFilename] = useState(packInfo.iconFilename || 'ts.png');
  const [fillerFilename, setFillerFilename] = useState(packInfo.fillerImageFilename || '_pack_filler_image.png');
  const [selectedChars, setSelectedChars] = useState<string[]>(packInfo.preselectedDubCharacters);
  const [disableDubTimestamps, setDisableDubTimestamps] = useState(packInfo.disableDubTimestamps || false);
  const [excludeDraftJson, setExcludeDraftJson] = useState(packInfo.excludeDraftJson || false);
  const [excludeVideo, setExcludeVideo] = useState(packInfo.excludeVideo || false);

  useEffect(() => {
    if (isOpen) {
      setTitle(packInfo.title);
      setSceneId(packInfo.sceneId || '');
      setAuthorsStr(packInfo.authors.join(', '));
      setReadme(packInfo.readme);
      setIconFilename(packInfo.iconFilename || 'ts.png');
      setFillerFilename(packInfo.fillerImageFilename || '_pack_filler_image.png');
      setSelectedChars(packInfo.preselectedDubCharacters);
      setDisableDubTimestamps(packInfo.disableDubTimestamps || false);
      setExcludeDraftJson(packInfo.excludeDraftJson || false);
      setExcludeVideo(packInfo.excludeVideo || false);
    }
  }, [isOpen, packInfo]);

  if (!isOpen) return null;

  const handleToggleChar = (charName: string) => {
    if (selectedChars.includes(charName)) {
      setSelectedChars(selectedChars.filter(c => c !== charName));
    } else {
      setSelectedChars([...selectedChars, charName]);
    }
  };

  const handleFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const authorsArr = authorsStr
      .split(',')
      .map(s => s.trim())
      .filter(Boolean);

    onSave({
      ...packInfo,
      title,
      sceneId: sceneId.trim() || undefined,
      authors: authorsArr.length > 0 ? authorsArr : ['Anonymous'],
      readme,
      iconFilename,
      fillerImageFilename: fillerFilename,
      preselectedDubCharacters: selectedChars,
      disableDubTimestamps,
      excludeDraftJson,
      excludeVideo,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-lg w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="bg-zinc-950 px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-amber-400" />
            <h2 className="text-sm font-bold text-zinc-100">Scene metadata</h2>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-200 p-1 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleFormSubmit} className="p-4 space-y-4 text-xs">
          {/* Title */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Scene Title <span className="text-amber-400 font-sans text-[11px]">(title)</span>
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g., Miles & the Prowler"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500"
              required
            />
          </div>

          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Scene ID <span className="text-amber-400 font-sans text-[11px]">(id in scenes.json)</span>
            </label>
            <input
              type="text"
              value={sceneId}
              onChange={(e) => setSceneId(e.target.value.toLowerCase().replace(/[^a-z0-9]/g, ''))}
              placeholder="e.g. milesprowler"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500 font-mono"
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">Only lowercase letters and numbers. Empty = auto from title.</p>
          </div>

          {/* Authors */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Authors <span className="text-amber-400 font-sans text-[11px]">(authors=[&quot;Name1&quot;, &quot;Name2&quot;])</span>
            </label>
            <input
              type="text"
              value={authorsStr}
              onChange={(e) => setAuthorsStr(e.target.value)}
              placeholder="e.g., Sticks456546, Modder2"
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500"
            />
            <p className="text-[10px] text-zinc-400 mt-0.5">Separate multiple author names with commas.</p>
          </div>

          {/* Readme */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Readme Description <span className="text-amber-400 font-sans text-[11px]">(readme)</span>
            </label>
            <textarea
              rows={3}
              value={readme}
              onChange={(e) => setReadme(e.target.value)}
              placeholder="Describe your voice modpack..."
              className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500 resize-none"
            />
          </div>

          {/* Filenames */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-zinc-300 font-semibold mb-1">
                Pack Icon Filename <span className="text-amber-400 font-sans text-[11px]">(icon)</span>
              </label>
              <input
                type="text"
                value={iconFilename}
                onChange={(e) => setIconFilename(e.target.value)}
                placeholder="ts.png or _icon.png"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500 font-sans"
              />
            </div>

            <div>
              <label className="block text-zinc-300 font-semibold mb-1">
                Filler Image Filename
              </label>
              <input
                type="text"
                value={fillerFilename}
                onChange={(e) => setFillerFilename(e.target.value)}
                placeholder="_pack_filler_image.png"
                className="w-full bg-zinc-950 border border-zinc-800 rounded px-3 py-1.5 text-zinc-100 focus:outline-none focus:border-amber-500 font-sans"
              />
            </div>
          </div>

          {/* Preselected Dub Characters */}
          <div>
            <label className="block text-zinc-300 font-semibold mb-1">
              Preselected Dub Characters <span className="text-amber-400 font-sans text-[11px]">(preselected_dub_characters)</span>
            </label>
            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 max-h-28 overflow-y-auto space-y-1">
              {characters.length === 0 ? (
                <p className="text-zinc-500 italic text-[11px]">No characters available. Add characters first.</p>
              ) : (
                characters.map((c) => {
                  const isSelected = selectedChars.includes(c.name);
                  return (
                    <button
                      type="button"
                      key={c.id}
                      onClick={() => handleToggleChar(c.name)}
                      className="w-full flex items-center justify-between p-1.5 rounded hover:bg-zinc-900 text-zinc-300 transition-colors text-left"
                    >
                      <span className="font-medium flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color }} />
                        {c.name}
                      </span>
                      {isSelected && <Check className="w-3.5 h-3.5 text-amber-400" />}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* Project-wide Dub Timestamps Toggle */}
          <div
            onClick={() => setDisableDubTimestamps(!disableDubTimestamps)}
            className="flex items-center gap-2 cursor-pointer group select-none py-2 px-3 bg-zinc-950 rounded-lg border border-zinc-800 hover:border-zinc-800 transition-colors"
          >
            <div
              className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 ${
                disableDubTimestamps
                  ? 'bg-amber-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800 border border-zinc-800 group-hover:border-zinc-500 text-transparent'
              }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
            <span className="text-zinc-300 font-medium text-xs">
              Turn off Dub Timestamps for entire project (omit <code className="text-amber-400">dub_timestamps</code> in INI)
            </span>
          </div>

          {/* Exclude Draft JSON Toggle */}
          <div
            onClick={() => setExcludeDraftJson(!excludeDraftJson)}
            className="flex items-center gap-2 cursor-pointer group select-none py-2 px-3 bg-zinc-950 rounded-lg border border-zinc-800 hover:border-zinc-800 transition-colors"
          >
            <div
              className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 ${
                excludeDraftJson
                  ? 'bg-amber-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800 border border-zinc-800 group-hover:border-zinc-500 text-transparent'
              }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
            <span className="text-zinc-300 font-medium text-xs">
              Exclude <code className="text-amber-400">_draft_project.json</code> from ZIP export
            </span>
          </div>

          {/* Exclude Video Toggle */}
          <div
            onClick={() => setExcludeVideo(!excludeVideo)}
            className="flex items-center gap-2 cursor-pointer group select-none py-2 px-3 bg-zinc-950 rounded-lg border border-zinc-800 hover:border-zinc-800 transition-colors"
          >
            <div
              className={`w-4 h-4 rounded flex items-center justify-center transition-colors shrink-0 ${
                excludeVideo
                  ? 'bg-amber-500 text-zinc-950 font-bold'
                  : 'bg-zinc-800 border border-zinc-800 group-hover:border-zinc-500 text-transparent'
              }`}
            >
              <Check className="w-3 h-3 stroke-[3]" />
            </div>
            <span className="text-zinc-300 font-medium text-xs">
              Exclude <code className="text-amber-400">dub_video.mp4</code> video from ZIP export (for manual upload)
            </span>
          </div>

          {/* Footer buttons */}
          <div className="flex items-center justify-end gap-2 pt-2 border-t border-zinc-800">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-medium cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-1.5 rounded bg-[#d97706] hover:bg-[#f59e0b] text-white font-bold flex items-center gap-1.5 border-none cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>Save Configuration</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
