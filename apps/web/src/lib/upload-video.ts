export interface UploadProgress {
	loaded: number;
	percent: number;
	total: number;
}

const EXTENSION_PATTERN = /\.[^.]+$/;

export function uploadVideoWithProgress(
	uploadUrl: string,
	file: File,
	onProgress: (progress: UploadProgress) => void
): Promise<void> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", uploadUrl);
		xhr.setRequestHeader("Content-Type", file.type || "video/mp4");

		xhr.upload.addEventListener("progress", (event) => {
			if (!event.lengthComputable) {
				return;
			}
			onProgress({
				loaded: event.loaded,
				total: event.total,
				percent: Math.round((event.loaded / event.total) * 100),
			});
		});

		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				resolve();
				return;
			}
			reject(new Error(`Upload failed with status ${xhr.status}`));
		});

		xhr.addEventListener("error", () => {
			reject(new Error("Upload network error"));
		});

		xhr.send(file);
	});
}

export function titleFromFilename(filename: string): string {
	const base = filename.replace(EXTENSION_PATTERN, "");
	return base || filename;
}
