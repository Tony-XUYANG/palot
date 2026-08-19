/**
 * Settings tab for managing OpenCode server connections.
 *
 * Lists all configured servers (local + remote), allows adding/editing/removing
 * remote servers, testing connections, and switching the active server.
 * Includes configuration for the local server's hostname, port, and password.
 */

import { Button } from "@palot/ui/components/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@palot/ui/components/dialog";
import { Input } from "@palot/ui/components/input";
import { Label } from "@palot/ui/components/label";
import { Switch } from "@palot/ui/components/switch";
import {
	CheckCircle2Icon,
	ChevronRightIcon,
	CircleAlertIcon,
	GlobeIcon,
	Loader2Icon,
	MonitorIcon,
	PencilIcon,
	PlusIcon,
	RadarIcon,
	SaveIcon,
	SettingsIcon,
	TerminalIcon,
	TrashIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type {
	LocalServerConfig,
	RemoteServerConfig,
} from "../../../preload/api";
import { useServerActions, useServers } from "../../hooks/use-servers";
import { useSettings } from "../../hooks/use-settings";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

// ============================================================
// Main component
// ============================================================

export function ServerSettings() {
	const { t } = useTranslation("settings");
	const { servers, activeServer, discoveredMdns } = useServers();
	const { switchServer, removeServer, saveDiscoveredServer } =
		useServerActions();
	const [editingServer, setEditingServer] = useState<RemoteServerConfig | null>(
		null,
	);
	const [savingMdnsId, setSavingMdnsId] = useState<string | null>(null);

	// Filter out discovered servers that are already saved
	const unsavedDiscovered = useMemo(() => {
		const savedUrls = new Set(
			servers
				.filter((s) => s.type === "remote")
				.map((s) => {
					try {
						const u = new URL(s.url);
						return `${u.hostname}:${u.port || (u.protocol === "https:" ? "443" : "80")}`;
					} catch {
						return null;
					}
				})
				.filter(Boolean),
		);

		return discoveredMdns.filter((d) => {
			const hostPort = `${d.host}:${d.port}`;
			if (savedUrls.has(hostPort)) return false;
			for (const addr of d.addresses) {
				if (savedUrls.has(`${addr}:${d.port}`)) return false;
			}
			return true;
		});
	}, [servers, discoveredMdns]);

	const handleSaveDiscovered = useCallback(
		async (mdnsId: string) => {
			const mdnsServer = discoveredMdns.find((s) => s.id === mdnsId);
			if (!mdnsServer) return;
			setSavingMdnsId(mdnsId);
			try {
				await saveDiscoveredServer(mdnsServer);
			} finally {
				setSavingMdnsId(null);
			}
		},
		[discoveredMdns, saveDiscoveredServer],
	);

	return (
		<div className="space-y-8">
			<div className="flex items-center justify-between">
				<div>
					<h2 className="text-xl font-semibold">{t("servers.title")}</h2>
					<p className="mt-1 text-sm text-muted-foreground">
						{t("servers.description")}
					</p>
				</div>
				<AddServerDialog />
			</div>

			<SettingsSection>
				{servers.map((server) => {
					const isActive = activeServer.id === server.id;
					const isLocal = server.type === "local";

					return (
						<div
							key={server.id}
							className="flex items-center justify-between gap-4 px-4 py-3"
						>
							<div className="flex min-w-0 items-center gap-3">
								{/* Icon */}
								<div
									className={`flex size-8 shrink-0 items-center justify-center rounded-md ${
										isActive
											? "bg-primary/10 text-primary"
											: "bg-muted text-muted-foreground"
									}`}
								>
									{isLocal ? (
										<MonitorIcon aria-hidden="true" className="size-4" />
									) : (
										<GlobeIcon aria-hidden="true" className="size-4" />
									)}
								</div>

								{/* Name + details */}
								<div className="min-w-0">
									<div className="flex items-center gap-2">
										<span className="truncate text-sm font-medium">
											{server.name}
										</span>
										{isActive && (
											<span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">
												{t("servers.active")}
											</span>
										)}
									</div>
									<span className="block truncate text-xs text-muted-foreground">
										{isLocal
											? t("servers.localManaged")
											: server.type === "remote"
												? server.url
												: `SSH: ${(server as { sshHost: string }).sshHost}`}
									</span>
								</div>
							</div>

							{/* Actions */}
							<div className="flex shrink-0 items-center gap-1">
								{!isActive && (
									<Button
										variant="outline"
										size="sm"
										onClick={() => switchServer(server.id)}
									>
										{t("common:actions.connect")}
									</Button>
								)}
								{!isLocal && server.type === "remote" && (
									<>
										<Button
											variant="ghost"
											size="icon-sm"
											onClick={() => setEditingServer(server)}
										>
											<PencilIcon aria-hidden="true" className="size-3.5" />
											<span className="sr-only">
												{t("common:actions.edit")}
											</span>
										</Button>
										<Button
											variant="ghost"
											size="icon-sm"
											className="text-destructive hover:text-destructive"
											onClick={() => removeServer(server.id)}
										>
											<TrashIcon aria-hidden="true" className="size-3.5" />
											<span className="sr-only">
												{t("common:actions.delete")}
											</span>
										</Button>
									</>
								)}
							</div>
						</div>
					);
				})}
			</SettingsSection>

			{/* Local server configuration */}
			<LocalServerSettings />

			{/* Discovered servers (mDNS) */}
			{unsavedDiscovered.length > 0 && (
				<>
					<div>
						<h3 className="flex items-center gap-2 text-base font-semibold">
							<RadarIcon aria-hidden="true" className="size-4" />
							{t("servers.discovered")}
						</h3>
						<p className="mt-1 text-sm text-muted-foreground">
							{t("servers.discoveredDescription")}
						</p>
					</div>

					<SettingsSection>
						{unsavedDiscovered.map((mdns) => {
							const displayAddr =
								mdns.addresses.find((a) => !a.includes(":")) || mdns.host;

							return (
								<div
									key={mdns.id}
									className="flex items-center justify-between gap-4 px-4 py-3"
								>
									<div className="flex min-w-0 items-center gap-3">
										<div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
											<RadarIcon aria-hidden="true" className="size-4" />
										</div>
										<div className="min-w-0">
											<span className="block truncate text-sm font-medium">
												{mdns.name}
											</span>
											<span className="block truncate text-xs text-muted-foreground">
												{displayAddr}:{mdns.port}
											</span>
										</div>
									</div>
									<Button
										variant="outline"
										size="sm"
										disabled={savingMdnsId === mdns.id}
										onClick={() => handleSaveDiscovered(mdns.id)}
									>
										{savingMdnsId === mdns.id ? (
											<Loader2Icon
												aria-hidden="true"
												className="size-3.5 animate-spin"
											/>
										) : (
											<SaveIcon aria-hidden="true" className="size-3.5" />
										)}
										{t("common:actions.save")}
									</Button>
								</div>
							);
						})}
					</SettingsSection>
				</>
			)}

			{/* Edit dialog (rendered outside the list to avoid re-mount on list changes) */}
			{editingServer && (
				<ServerFormDialog
					mode="edit"
					server={editingServer}
					open
					onOpenChange={(open) => {
						if (!open) setEditingServer(null);
					}}
				/>
			)}
		</div>
	);
}

// ============================================================
// Local server configuration
// ============================================================

const isElectron = typeof window !== "undefined" && "palot" in window;

function LocalServerSettings() {
	const { t } = useTranslation("settings");
	const { settings, updateSettings } = useSettings();
	const localServer = settings.servers.servers.find((s) => s.id === "local") as
		| LocalServerConfig
		| undefined;

	const [hostname, setHostname] = useState(localServer?.hostname ?? "");
	const [port, setPort] = useState(localServer?.port?.toString() ?? "");
	const [password, setPassword] = useState("");
	const [hasPassword, setHasPassword] = useState(
		localServer?.hasPassword ?? false,
	);
	const [mdns, setMdns] = useState(localServer?.mdns ?? false);
	const [mdnsDomain, setMdnsDomain] = useState(localServer?.mdnsDomain ?? "");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState(false);

	// Sync form state when settings are loaded asynchronously
	useEffect(() => {
		setHostname(localServer?.hostname ?? "");
		setPort(localServer?.port?.toString() ?? "");
		setHasPassword(localServer?.hasPassword ?? false);
		setMdns(localServer?.mdns ?? false);
		setMdnsDomain(localServer?.mdnsDomain ?? "");
	}, [
		localServer?.hostname,
		localServer?.port,
		localServer?.hasPassword,
		localServer?.mdns,
		localServer?.mdnsDomain,
	]);

	// Track whether form values differ from persisted settings
	const isDirty = useMemo(() => {
		const currentHostname = localServer?.hostname ?? "";
		const currentPort = localServer?.port?.toString() ?? "";
		const currentHasPassword = localServer?.hasPassword ?? false;
		const currentMdns = localServer?.mdns ?? false;
		const currentMdnsDomain = localServer?.mdnsDomain ?? "";

		return (
			hostname !== currentHostname ||
			port !== currentPort ||
			password.length > 0 ||
			hasPassword !== currentHasPassword ||
			mdns !== currentMdns ||
			mdnsDomain !== currentMdnsDomain
		);
	}, [hostname, port, password, hasPassword, mdns, mdnsDomain, localServer]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		setSaved(false);

		try {
			// Store password in secure storage if provided
			if (password && isElectron) {
				await window.palot.credential.store("local", password);
			} else if (!hasPassword && isElectron) {
				// If password was cleared, delete stored credential
				await window.palot.credential.delete("local");
			}

			// Update local server config in settings
			const currentServers = settings.servers.servers;
			const updatedServers = currentServers.map((s) => {
				if (s.id !== "local") return s;
				return {
					id: "local" as const,
					name: s.name,
					type: "local" as const,
					hostname: hostname.trim() || undefined,
					port: port.trim() ? Number.parseInt(port.trim(), 10) : undefined,
					hasPassword: password.length > 0 ? true : hasPassword,
					mdns,
					mdnsDomain: mdnsDomain.trim() || undefined,
				} satisfies LocalServerConfig;
			});

			await updateSettings({
				servers: {
					servers: updatedServers,
					activeServerId: settings.servers.activeServerId,
				},
			});

			// Restart the server to apply new settings
			if (isElectron) {
				await window.palot.restartOpenCode();
			}

			setPassword("");
			setSaved(true);
			setTimeout(() => setSaved(false), 3000);
		} finally {
			setSaving(false);
		}
	}, [
		hostname,
		port,
		password,
		hasPassword,
		mdns,
		mdnsDomain,
		settings,
		updateSettings,
	]);

	const handleClearPassword = useCallback(async () => {
		if (isElectron) {
			await window.palot.credential.delete("local");
		}
		setHasPassword(false);
		setPassword("");

		// Update settings to reflect no password
		const currentServers = settings.servers.servers;
		const updatedServers = currentServers.map((s) => {
			if (s.id !== "local") return s;
			return { ...s, hasPassword: false };
		});

		await updateSettings({
			servers: {
				servers: updatedServers,
				activeServerId: settings.servers.activeServerId,
			},
		});

		// Restart the server without password
		if (isElectron) {
			await window.palot.restartOpenCode();
		}
	}, [settings, updateSettings]);

	return (
		<>
			<div>
				<h3 className="flex items-center gap-2 text-base font-semibold">
					<SettingsIcon aria-hidden="true" className="size-4" />
					{t("servers.localConfiguration")}
				</h3>
				<p className="mt-1 text-sm text-muted-foreground">
					{t("servers.localConfigurationDescription")}
				</p>
			</div>

			<SettingsSection>
				<SettingsRow
					label={t("servers.hostname")}
					description={t("servers.hostnameDescription")}
				>
					<Input
						className="w-[200px]"
						placeholder="127.0.0.1"
						value={hostname}
						onChange={(e) => setHostname(e.target.value)}
					/>
				</SettingsRow>

				<SettingsRow
					label={t("servers.port")}
					description={t("servers.portDescription")}
				>
					<Input
						className="w-[200px]"
						placeholder="4101"
						type="number"
						min={1}
						max={65535}
						value={port}
						onChange={(e) => setPort(e.target.value)}
					/>
				</SettingsRow>

				<SettingsRow
					label={t("servers.password")}
					description={t("servers.passwordDescription")}
				>
					<div className="flex items-center gap-2">
						{hasPassword && !password && (
							<>
								<span className="text-xs text-muted-foreground">
									{t("servers.passwordSet")}
								</span>
								<Button variant="ghost" size="sm" onClick={handleClearPassword}>
									{t("servers.clear")}
								</Button>
							</>
						)}
						<Input
							className="w-[200px]"
							type="password"
							placeholder={
								hasPassword ? t("servers.newPassword") : t("servers.optional")
							}
							value={password}
							onChange={(e) => setPassword(e.target.value)}
						/>
					</div>
				</SettingsRow>

				<SettingsRow
					label={t("servers.mdns")}
					description={t("servers.mdnsDescription")}
				>
					<Switch checked={mdns} onCheckedChange={setMdns} />
				</SettingsRow>

				{mdns && (
					<SettingsRow
						label={t("servers.mdnsDomain")}
						description={t("servers.mdnsDomainDescription")}
					>
						<Input
							className="w-[200px]"
							placeholder="opencode.local"
							value={mdnsDomain}
							onChange={(e) => setMdnsDomain(e.target.value)}
						/>
					</SettingsRow>
				)}

				<div className="flex items-center justify-between px-4 py-3">
					<div className="flex items-center gap-2">
						{saved && (
							<span className="flex items-center gap-1 text-sm text-green-600">
								<CheckCircle2Icon aria-hidden="true" className="size-3.5" />
								{t("servers.savedRestarted")}
							</span>
						)}
					</div>
					<Button size="sm" disabled={!isDirty || saving} onClick={handleSave}>
						{saving && (
							<Loader2Icon
								aria-hidden="true"
								className="size-3.5 animate-spin"
							/>
						)}
						{t("servers.saveRestart")}
					</Button>
				</div>
			</SettingsSection>
		</>
	);
}

// ============================================================
// Add Server dialog (trigger button)
// ============================================================

function AddServerDialog() {
	const { t } = useTranslation("settings");
	const [open, setOpen] = useState(false);

	return (
		<ServerFormDialog mode="add" open={open} onOpenChange={setOpen}>
			<Button variant="outline" size="sm">
				<PlusIcon aria-hidden="true" className="size-4" />
				{t("servers.addServer")}
			</Button>
		</ServerFormDialog>
	);
}

// ============================================================
// Server form dialog (add or edit)
// ============================================================

interface ServerFormDialogProps {
	mode: "add" | "edit";
	server?: RemoteServerConfig;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	children?: React.ReactNode;
}

function ServerFormDialog({
	mode,
	server,
	open,
	onOpenChange,
	children,
}: ServerFormDialogProps) {
	const { t } = useTranslation("settings");
	const { addServer, updateServer, testConnection } = useServerActions();

	const [name, setName] = useState(server?.name ?? "");
	const [url, setUrl] = useState(server?.url ?? "");
	const [username, setUsername] = useState(server?.username ?? "");
	const [password, setPassword] = useState("");
	const [testing, setTesting] = useState(false);
	const [testResult, setTestResult] = useState<string | null | undefined>(
		undefined,
	);
	const [saving, setSaving] = useState(false);
	const [showSshTip, setShowSshTip] = useState(false);

	// Reset form when dialog opens
	const handleOpenChange = useCallback(
		(nextOpen: boolean) => {
			if (nextOpen) {
				setName(server?.name ?? "");
				setUrl(server?.url ?? "");
				setUsername(server?.username ?? "");
				setPassword("");
				setTestResult(undefined);
				setTesting(false);
				setSaving(false);
				setShowSshTip(false);
			}
			onOpenChange(nextOpen);
		},
		[server, onOpenChange],
	);

	const handleTest = useCallback(async () => {
		setTesting(true);
		setTestResult(undefined);
		const result = await testConnection(
			url,
			username || undefined,
			password || undefined,
		);
		setTestResult(result);
		setTesting(false);
	}, [url, username, password, testConnection]);

	const handleSave = useCallback(async () => {
		setSaving(true);
		try {
			if (mode === "add") {
				const id = `remote-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
				const newServer: RemoteServerConfig = {
					id,
					name: name.trim() || t("servers.remoteServer"),
					type: "remote",
					url: url.trim(),
					username: username.trim() || undefined,
					hasPassword: !!password,
				};
				await addServer(newServer, password || undefined);
			} else if (server) {
				await updateServer(
					server.id,
					{
						name: name.trim() || server.name,
						url: url.trim() || server.url,
						username: username.trim() || undefined,
					},
					password || undefined,
				);
			}
			onOpenChange(false);
		} finally {
			setSaving(false);
		}
	}, [
		mode,
		server,
		name,
		url,
		username,
		password,
		addServer,
		updateServer,
		onOpenChange,
		t,
	]);

	const isValid = url.trim().length > 0;

	const dialogContent = (
		<DialogContent className="sm:max-w-md">
			<DialogHeader>
				<DialogTitle>
					{mode === "add" ? t("servers.addRemote") : t("servers.editServer")}
				</DialogTitle>
				<DialogDescription>
					{mode === "add"
						? t("servers.connectRemote")
						: t("servers.editDescription", { server: server?.name })}
				</DialogDescription>
			</DialogHeader>

			<div className="space-y-4 py-4">
				{/* Name */}
				<div className="space-y-2">
					<Label htmlFor="server-name">{t("servers.name")}</Label>
					<Input
						id="server-name"
						placeholder={t("servers.namePlaceholder")}
						value={name}
						onChange={(e) => setName(e.target.value)}
					/>
				</div>

				{/* URL */}
				<div className="space-y-2">
					<Label htmlFor="server-url">URL</Label>
					<Input
						id="server-url"
						placeholder="https://opencode.example.com:4096"
						value={url}
						onChange={(e) => setUrl(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						{t("servers.urlDescription")}
					</p>
				</div>

				{/* Username */}
				<div className="space-y-2">
					<Label htmlFor="server-username">{t("servers.username")}</Label>
					<Input
						id="server-username"
						placeholder={t("servers.usernamePlaceholder")}
						value={username}
						onChange={(e) => setUsername(e.target.value)}
					/>
				</div>

				{/* Password */}
				<div className="space-y-2">
					<Label htmlFor="server-password">{t("servers.password")}</Label>
					<Input
						id="server-password"
						type="password"
						placeholder={
							mode === "edit" && server?.hasPassword
								? t("servers.keepPassword")
								: t("servers.optional")
						}
						value={password}
						onChange={(e) => setPassword(e.target.value)}
					/>
					<p className="text-xs text-muted-foreground">
						{t("servers.secureStorage")}
					</p>
				</div>

				{/* Test connection */}
				<div className="flex items-center gap-2">
					<Button
						variant="outline"
						size="sm"
						disabled={!isValid || testing}
						onClick={handleTest}
					>
						{testing && (
							<Loader2Icon
								aria-hidden="true"
								className="size-3.5 animate-spin"
							/>
						)}
						{t("servers.testConnection")}
					</Button>
					{testResult === null && (
						<span className="flex items-center gap-1 text-sm text-green-600">
							<CheckCircle2Icon aria-hidden="true" className="size-3.5" />
							{t("common:states.connected")}
						</span>
					)}
					{testResult !== null && testResult !== undefined && (
						<span className="flex items-center gap-1 text-sm text-destructive">
							<CircleAlertIcon aria-hidden="true" className="size-3.5" />
							{testResult}
						</span>
					)}
				</div>

				{/* SSH port forwarding tip */}
				<div>
					<button
						type="button"
						onClick={() => setShowSshTip((v) => !v)}
						className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
					>
						<ChevronRightIcon
							aria-hidden="true"
							className={`size-3 transition-transform ${showSshTip ? "rotate-90" : ""}`}
						/>
						<TerminalIcon aria-hidden="true" className="size-3" />
						{t("servers.sshQuestion")}
					</button>
					{showSshTip && (
						<div className="mt-2 space-y-2 rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">
							<p>{t("servers.sshForward")}</p>
							<pre className="overflow-x-auto rounded bg-zinc-950 px-2.5 py-1.5 font-mono text-[11px] text-zinc-300">
								ssh -L 4096:localhost:4096 user@remote-host
							</pre>
							<p>{t("servers.sshUseUrl")}</p>
						</div>
					)}
				</div>
			</div>

			<DialogFooter>
				<DialogClose render={<Button variant="outline" />}>
					{t("common:actions.cancel")}
				</DialogClose>
				<Button disabled={!isValid || saving} onClick={handleSave}>
					{saving && (
						<Loader2Icon aria-hidden="true" className="size-3.5 animate-spin" />
					)}
					{mode === "add" ? t("servers.addServer") : t("servers.saveChanges")}
				</Button>
			</DialogFooter>
		</DialogContent>
	);

	// When used as a trigger (add mode), wrap with DialogTrigger
	if (children) {
		return (
			<Dialog open={open} onOpenChange={handleOpenChange}>
				<DialogTrigger render={children as React.ReactElement} />
				{dialogContent}
			</Dialog>
		);
	}

	// Edit mode: controlled dialog without trigger
	return (
		<Dialog open={open} onOpenChange={handleOpenChange}>
			{dialogContent}
		</Dialog>
	);
}
