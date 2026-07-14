import type { ReactNode } from "react";

export default function StudioShell({ children }: { children: ReactNode }) {
	return (
		<div className="flex h-svh min-h-0 flex-col overflow-hidden p-3">
			<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
				{children}
			</div>
		</div>
	);
}
