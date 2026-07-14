"use client";

import { Slider } from "@ontology/ui/components/slider";
import { Volume1, Volume2, VolumeX } from "lucide-react";

import { useStudioVideoRef } from "@/hooks/use-studio-store";
import { useVideoAudio } from "@/hooks/use-video-audio";

export const ICON_BUTTON_CLASSNAME =
	"p-1 text-muted-foreground transition-colors hover:text-foreground";

function VolumeIcon({ muted, volume }: { muted: boolean; volume: number }) {
	if (muted || volume === 0) {
		return <VolumeX className="size-3.5" />;
	}
	if (volume < 0.5) {
		return <Volume1 className="size-3.5" />;
	}
	return <Volume2 className="size-3.5" />;
}

export default function VolumeControl() {
	const videoRef = useStudioVideoRef();
	const { volume, muted, setVideoVolume, toggleMute } = useVideoAudio(videoRef);

	return (
		<div className="group/vol flex items-center">
			<button
				aria-label={muted ? "Unmute" : "Mute"}
				className={ICON_BUTTON_CLASSNAME}
				onClick={toggleMute}
				type="button"
			>
				<VolumeIcon muted={muted} volume={volume} />
			</button>
			<div className="w-0 overflow-hidden transition-[width] duration-200 group-focus-within/vol:w-20 group-hover/vol:w-20">
				<div className="w-20 px-1">
					<Slider
						aria-label="Volume"
						max={100}
						min={0}
						onValueChange={(values) => {
							const next = Array.isArray(values) ? values[0] : values;
							if (next !== undefined) {
								setVideoVolume(next / 100);
							}
						}}
						step={5}
						value={[Math.round(volume * 100)]}
					/>
				</div>
			</div>
		</div>
	);
}
