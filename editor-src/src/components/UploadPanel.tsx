import React, { useRef } from 'react';
import { Film, Music, Image as ImageIcon, Trash2, Upload, AlertTriangle } from 'lucide-react';
import { MediaSource, PackInfo } from '../types';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

interface UploadPanelProps {
  videoMedia?: MediaSource;
  backingTrackMedia?: MediaSource;
  packInfo: PackInfo;
  onUploadVideo: (file: File) => void;
  onUploadBackingTrack: (file: File) => void;
  onUploadPackIcon: (file: File) => void;
  onUploadFillerImage: (file: File) => void;
  onRemoveVideo: () => void;
  onRemoveBackingTrack: () => void;
  onRemovePackIcon: () => void;
  onRemoveFillerImage: () => void;
}

export const UploadPanel: React.FC<UploadPanelProps> = ({
  videoMedia,
  backingTrackMedia,
  packInfo,
  onUploadVideo,
  onUploadBackingTrack,
  onUploadPackIcon,
  onUploadFillerImage,
  onRemoveVideo,
  onRemoveBackingTrack,
  onRemovePackIcon,
  onRemoveFillerImage,
}) => {
  const videoInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const iconInputRef = useRef<HTMLInputElement>(null);
  const fillerInputRef = useRef<HTMLInputElement>(null);

  const handleFileDrop = (e: React.DragEvent<HTMLDivElement>, callback: (file: File) => void, isVideo = false) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (isVideo) {
        const ext = file.name.split('.').pop() || 'mp4';
        if (ext.toLowerCase() !== 'mp4') {
          alert('Only .mp4 format is supported.');
          return;
        }
        const renamedFile = new File([file], `dub_video.${ext}`, { type: file.type });
        callback(renamedFile);
      } else {
        callback(file);
      }
    }
  };

  return (
    <div className="flex flex-col gap-3 p-4 bg-[#121214] border border-zinc-800/80 rounded-xl text-xs shrink-0">
      <div className="flex items-center justify-between pb-2 border-b border-zinc-800/80">
        <h2 className="font-bold text-zinc-100 flex items-center gap-1.5 uppercase tracking-wide text-[11px]">
          <Upload className="w-3.5 h-3.5 text-amber-500" />
          Media & Asset Library
        </h2>
      </div>

      {/* 1. Main Video File (dub_video) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-zinc-300 font-medium">
          <span className="flex items-center gap-1.5">
            <Film className="w-3.5 h-3.5 text-amber-400" />
            Main Video <span className="text-[10px] text-zinc-400 font-sans">(dub_video)</span>
          </span>
          <span className="text-[10px] text-amber-400 font-sans font-bold">Required</span>
        </div>

        {videoMedia ? (
          <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
            <div className="truncate max-w-[180px]">
              <p className="font-medium text-zinc-200 truncate">{videoMedia.name}</p>
              <p className="text-[10px] text-zinc-400 font-sans">
                Duration: {videoMedia.duration.toFixed(2)}s
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onRemoveVideo}
                  className="p-1 text-zinc-400 hover:text-red-400 transition-colors backdrop-blur-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Remove Video</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleFileDrop(e, onUploadVideo, true)}
            onClick={() => videoInputRef.current?.click()}
            className="border-2 border-dashed border-zinc-800 hover:border-amber-500 bg-zinc-950/50 p-3 rounded text-center cursor-pointer transition-colors"
          >
            <input
              ref={videoInputRef}
              type="file"
              accept=".mp4"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  const file = e.target.files[0];
                  const ext = file.name.split('.').pop() || 'mp4';
                  if (ext.toLowerCase() !== 'mp4') {
                    alert('Only .mp4 format is supported.');
                    return;
                  }
                  const renamedFile = new File([file], `dub_video.${ext}`, { type: file.type });
                  onUploadVideo(renamedFile);
                }
              }}
            />
            <Film className="w-5 h-5 mx-auto text-zinc-500 mb-1" />
            <p className="text-zinc-300 font-medium">Upload Video Clip</p>
            <p className="text-[10px] text-zinc-400 font-sans">.mp4 — exported as MP4, scaled to max 720p</p>
          </div>
        )}
      </div>

      {/* 2. Optional Backing Track (_backing_track) */}
      <div className="space-y-1">
        <div className="flex items-center justify-between text-zinc-300 font-medium">
          <span className="flex items-center gap-1.5">
            <Music className="w-3.5 h-3.5 text-amber-400" />
            Backing Track <span className="text-[10px] text-zinc-400 font-sans">(_backing_track)</span>
          </span>
          <span className="text-[10px] text-zinc-400">Optional</span>
        </div>

        {backingTrackMedia ? (
          <div className="flex items-center justify-between bg-zinc-950 p-2 rounded border border-zinc-800">
            <div className="truncate max-w-[180px]">
              <p className="font-medium text-zinc-200 truncate">{backingTrackMedia.name}</p>
              <p className="text-[10px] text-zinc-400 font-sans">
                Duration: {backingTrackMedia.duration.toFixed(2)}s
              </p>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onRemoveBackingTrack}
                  className="p-1 text-zinc-400 hover:text-red-400 transition-colors backdrop-blur-sm"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Remove Backing Track</TooltipContent>
            </Tooltip>
          </div>
        ) : (
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => handleFileDrop(e, onUploadBackingTrack)}
            onClick={() => audioInputRef.current?.click()}
            className="border-2 border-dashed border-zinc-800 hover:border-amber-500 bg-zinc-950/50 p-2.5 rounded text-center cursor-pointer transition-colors"
          >
            <input
              ref={audioInputRef}
              type="file"
              accept=".wav,.mp3,.ogg,audio/wav,audio/mpeg,audio/ogg"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.[0]) {
                  const file = e.target.files[0];
                  const ext = file.name.split('.').pop() || 'wav';
                  const renamedFile = new File([file], `_backing_track.${ext}`, { type: file.type });
                  onUploadBackingTrack(renamedFile);
                }
              }}
            />
            <Music className="w-4 h-4 mx-auto text-zinc-500 mb-1" />
            <p className="text-zinc-300 font-medium text-[11px]">Upload BGM/SFX Track</p>
            <p className="text-[10px] text-zinc-400 font-sans">.wav, .mp3, or .ogg</p>
          </div>
        )}
        <div className="flex justify-end mt-1">
          <a
            href="https://vocalremover.org"
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-amber-400 hover:text-amber-300 font-medium"
          >
            Need to remove vocals? Try VocalRemover.org
          </a>
        </div>
      </div>

      {/* Guidance Note */}
      <div className="bg-amber-500/10 border border-zinc-800 p-2 rounded text-[10px] text-amber-200/90 leading-tight flex items-start gap-1.5">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-0.5" />
        <p>
          <strong>Guideline:</strong> Remove voice dialogue from the backing track so in-game judges sample vocal overlap accurately.
        </p>
      </div>

      {/* 3. Pack Icon & Filler Image */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-zinc-800/80">
        {/* Pack Icon */}
        <div className="flex flex-col h-full space-y-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="text-zinc-400 text-[10px] font-bold block truncate">
                Pack Icon ({packInfo.iconFilename || '_icon.png'})
              </label>
            </TooltipTrigger>
            <TooltipContent>Pack Icon ({packInfo.iconFilename || '_icon.png'})</TooltipContent>
          </Tooltip>
          <div className="flex-1 min-h-[64px]">
          {packInfo.iconUrl ? (
            <div className="relative group w-full h-16 bg-[#0a0a0b] border border-zinc-800/80 rounded-lg flex items-center justify-center overflow-hidden">
              <img src={packInfo.iconUrl} alt="Icon" draggable={false} className="h-full object-contain" />
              <button
                onClick={onRemovePackIcon}
                className="absolute inset-0 bg-black/70 backdrop-blur-sm text-zinc-200 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => iconInputRef.current?.click()}
              className="w-full h-16 border border-dashed border-zinc-800/80 hover:border-amber-500/50 bg-[#0a0a0b] rounded-lg flex flex-col items-center justify-center text-zinc-500 hover:text-amber-400 transition-colors"
            >
              <ImageIcon className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Set Icon</span>
            </button>
          )}
          </div>
          <input
            ref={iconInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                const ext = e.target.files[0].name.split('.').pop() || 'png';
                const file = new File([e.target.files[0]], `_icon.${ext}`, { type: e.target.files[0].type });
                onUploadPackIcon(file);
              }
            }}
          />
        </div>

        {/* Filler Image */}
        <div className="flex flex-col h-full space-y-1.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <label className="text-zinc-400 text-[10px] font-bold block truncate">
                Filler Image ({packInfo.fillerImageFilename || '_pack_filler_image.png'})
              </label>
            </TooltipTrigger>
            <TooltipContent>Filler Image ({packInfo.fillerImageFilename || '_pack_filler_image.png'})</TooltipContent>
          </Tooltip>
          <div className="flex-1 min-h-[64px]">
          {packInfo.fillerImageUrl ? (
            <div className="relative group w-full h-16 bg-[#0a0a0b] border border-zinc-800/80 rounded-lg flex items-center justify-center overflow-hidden">
              <img src={packInfo.fillerImageUrl} alt="Filler" draggable={false} className="h-full object-contain" />
              <button
                onClick={onRemoveFillerImage}
                className="absolute inset-0 bg-black/70 backdrop-blur-sm text-zinc-200 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all"
              >
                <Trash2 className="w-5 h-5 text-red-400" />
              </button>
            </div>
          ) : (
            <button
              onClick={() => fillerInputRef.current?.click()}
              className="w-full h-16 border border-dashed border-zinc-800/80 hover:border-amber-500/50 bg-[#0a0a0b] rounded-lg flex flex-col items-center justify-center text-zinc-500 hover:text-amber-400 transition-colors"
            >
              <ImageIcon className="w-4 h-4 mb-1" />
              <span className="text-[10px] font-bold uppercase tracking-wider">Set Filler</span>
            </button>
          )}
          </div>
          <input
            ref={fillerInputRef}
            type="file"
            accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.[0]) {
                const ext = e.target.files[0].name.split('.').pop() || 'png';
                const file = new File([e.target.files[0]], `_pack_filler_image.${ext}`, { type: e.target.files[0].type });
                onUploadFillerImage(file);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
};
