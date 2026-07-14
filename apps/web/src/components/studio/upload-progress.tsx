import { formatBytes } from "@/lib/studio/formatters";
import type { UploadProgress as UploadProgressData } from "@/lib/upload-video";

export default function UploadProgress({
	filename,
	progress,
}: {
	filename: string;
	progress: UploadProgressData;
}) {
	return (
		<div className="absolute inset-x-0 bottom-0 border-border border-t bg-card p-3">
			<p className="mb-2 truncate text-[10px] text-muted-foreground uppercase tracking-widest">
				{filename}
			</p>
			<div className="h-1 w-full bg-secondary">
				<div
					className="h-full bg-foreground"
					style={{ width: `${progress.percent}%` }}
				/>
			</div>
			<p className="mt-2 text-[10px] text-muted-foreground tabular-nums tracking-wide">
				{formatBytes(progress.loaded)} / {formatBytes(progress.total)}{" "}
				&#47;&#47; {progress.percent}%
			</p>
		</div>
	);
}
