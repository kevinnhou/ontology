"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { cn } from "@ontology/ui/lib/utils";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";
import { type AuthFormValues, authSchema } from "@/lib/auth-schema";

type AuthMode = "in" | "up";

export default function AuthForm() {
	const router = useRouter();
	const [mode, setMode] = useState<AuthMode>("in");
	const [pending, setPending] = useState(false);

	const isSignIn = mode === "in";

	const {
		register,
		handleSubmit,
		formState: { errors },
	} = useForm<AuthFormValues>({
		resolver: zodResolver(authSchema),
		defaultValues: { email: "", password: "" },
	});

	async function handleGoogle() {
		setPending(true);
		try {
			const { error } = await authClient.signIn.social({
				provider: "google",
				callbackURL: "/",
			});
			if (error) {
				toast.error(error.message ?? "Google sign in failed");
			}
		} catch {
			toast.error("Google sign in failed");
		} finally {
			setPending(false);
		}
	}

	async function onSubmit(values: AuthFormValues) {
		setPending(true);

		try {
			if (isSignIn) {
				const { error } = await authClient.signIn.email({
					email: values.email,
					password: values.password,
					callbackURL: "/",
				});
				if (error) {
					toast.error(error.message ?? "Sign in failed");
					return;
				}
			} else {
				const { error } = await authClient.signUp.email({
					email: values.email,
					password: values.password,
					name: values.email.split("@")[0] || "scout",
					callbackURL: "/",
				});
				if (error) {
					toast.error(error.message ?? "Sign up failed");
					return;
				}
			}

			router.refresh();
		} catch {
			toast.error("Something went wrong");
		} finally {
			setPending(false);
		}
	}

	return (
		<div className="relative w-[min(100%,17rem)] border border-border bg-card before:pointer-events-none before:absolute before:-top-px before:-left-px before:size-1.5 before:border-foreground before:border-t before:border-l before:content-[''] after:pointer-events-none after:absolute after:-right-px after:-bottom-px after:size-1.5 after:border-foreground after:border-r after:border-b after:content-['']">
			<header className="flex items-stretch border-border border-b">
				<span className="flex flex-1 items-center px-3 text-[9px] text-muted-foreground uppercase tracking-[0.2em]">
					Sign
				</span>
				<div className="flex border-border border-l">
					{(["in", "up"] as const).map((tab) => (
						<button
							className={cn(
								"min-w-10 px-2 py-2 text-[9px] uppercase tracking-widest",
								mode === tab
									? "bg-foreground text-background"
									: "text-muted-foreground hover:text-foreground"
							)}
							key={tab}
							onClick={() => setMode(tab)}
							type="button"
						>
							{tab}
						</button>
					))}
				</div>
			</header>

			<div className="p-3">
				<button
					className="mb-3 w-full py-1.5 text-left text-[10px] text-muted-foreground uppercase italic tracking-widest hover:text-foreground disabled:opacity-40"
					disabled={pending}
					onClick={handleGoogle}
					type="button"
				>
					&gt; Google
				</button>

				<form
					className="space-y-3"
					noValidate
					onSubmit={handleSubmit(onSubmit)}
				>
					<div>
						<input
							autoComplete="email"
							className="h-9 w-full border-0 border-border border-b bg-transparent px-0 text-foreground text-xs shadow-none outline-none placeholder:text-muted-foreground/50 focus-visible:border-foreground focus-visible:ring-0"
							placeholder="email"
							type="email"
							{...register("email")}
						/>
						{errors.email && (
							<p className="mt-1 text-destructive text-xs" role="alert">
								{errors.email.message}
							</p>
						)}
					</div>
					<div>
						<input
							autoComplete={isSignIn ? "current-password" : "new-password"}
							className="h-9 w-full border-0 border-border border-b bg-transparent px-0 text-foreground text-xs shadow-none outline-none placeholder:text-muted-foreground/50 focus-visible:border-foreground focus-visible:ring-0"
							placeholder="password"
							type="password"
							{...register("password")}
						/>
						{errors.password && (
							<p className="mt-1 text-destructive text-xs" role="alert">
								{errors.password.message}
							</p>
						)}
					</div>
					<button
						className="w-full border border-foreground py-2 text-[10px] text-foreground uppercase tracking-[0.25em] transition-colors hover:bg-foreground hover:text-background disabled:opacity-40"
						disabled={pending}
						type="submit"
					>
						{pending ? "…" : "Enter"}
					</button>
				</form>
			</div>
		</div>
	);
}
