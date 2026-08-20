import {
	SidebarContent,
	SidebarGroup,
	SidebarGroupContent,
	SidebarMenu,
	SidebarMenuButton,
	SidebarMenuItem,
} from "@palot/ui/components/sidebar";
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import {
	ArrowLeftIcon,
	BellIcon,
	GitForkIcon,
	InfoIcon,
	PlugIcon,
	ServerIcon,
	SettingsIcon,
	WrenchIcon,
} from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useSetSidebarSlot } from "../sidebar-slot-context";

// ============================================================
// Tab definitions
// ============================================================

type SettingsTab =
	| "general"
	| "servers"
	| "notifications"
	| "providers"
	| "worktrees"
	| "setup"
	| "about";

const tabs: { id: SettingsTab; icon: typeof SettingsIcon }[] = [
	{ id: "general", icon: SettingsIcon },
	{ id: "servers", icon: ServerIcon },
	{ id: "notifications", icon: BellIcon },
	{ id: "providers", icon: PlugIcon },
	{ id: "worktrees", icon: GitForkIcon },
	{ id: "setup", icon: WrenchIcon },
	{ id: "about", icon: InfoIcon },
];

// ============================================================
// Settings layout (renders <Outlet /> for child routes)
// ============================================================

export function SettingsPage() {
	const { setContent, setFooter } = useSetSidebarSlot();

	useEffect(() => {
		setContent(<SettingsSidebarContent />);
		setFooter(false);
		return () => {
			setContent(null);
			setFooter(null);
		};
	}, [setContent, setFooter]);

	return (
		<div className="h-full overflow-y-auto">
			<div className="mx-auto max-w-2xl px-8 py-6">
				<Outlet />
			</div>
		</div>
	);
}

// ============================================================
// Sidebar content injected via slot context
// ============================================================

function SettingsSidebarContent() {
	const { t } = useTranslation("settings");
	const navigate = useNavigate();
	const pathname = useRouterState({ select: (s) => s.location.pathname });

	// Derive active tab from the last path segment (e.g. "/settings/general" -> "general")
	const activeTab = pathname.split("/").pop() || "general";

	return (
		<SidebarContent>
			<SidebarGroup>
				<SidebarGroupContent>
					<div className="px-2 py-1">
						<button
							type="button"
							onClick={() => navigate({ to: "/" })}
							className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
						>
							<ArrowLeftIcon aria-hidden="true" className="size-4" />
							{t("backToApp")}
						</button>
					</div>
					<SidebarMenu>
						{tabs.map((tab) => {
							const Icon = tab.icon;
							const label = t(`tabs.${tab.id}`);
							return (
								<SidebarMenuItem key={tab.id}>
									<SidebarMenuButton
										isActive={activeTab === tab.id}
										onClick={() => navigate({ to: `/settings/${tab.id}` })}
										tooltip={label}
									>
										<Icon aria-hidden="true" className="size-4" />
										<span>{label}</span>
									</SidebarMenuButton>
								</SidebarMenuItem>
							);
						})}
					</SidebarMenu>
				</SidebarGroupContent>
			</SidebarGroup>
		</SidebarContent>
	);
}
