import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@palot/ui/components/select";
import { Switch } from "@palot/ui/components/switch";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/use-settings";
import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

export function NotificationSettings() {
	const { t } = useTranslation("settings");
	const { settings, updateSettings } = useSettings();
	const notif = settings.notifications;

	const updateNotif = useCallback(
		(key: string, value: unknown) => {
			updateSettings({ notifications: { [key]: value } });
		},
		[updateSettings],
	);

	const isMac =
		typeof window !== "undefined" &&
		"palot" in window &&
		window.palot.platform === "darwin";

	return (
		<div className="space-y-8">
			<div>
				<h2 className="text-xl font-semibold">{t("notifications.title")}</h2>
			</div>

			<SettingsSection>
				<SettingsRow
					label={t("notifications.completion")}
					description={t("notifications.completionDescription")}
				>
					<Select
						value={notif.completionMode}
						onValueChange={(v) => updateNotif("completionMode", v)}
						items={{
							off: t("notifications.never"),
							unfocused: t("notifications.unfocused"),
							always: t("notifications.always"),
						}}
					>
						<SelectTrigger className="min-w-[180px]">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="off">{t("notifications.never")}</SelectItem>
							<SelectItem value="unfocused">
								{t("notifications.unfocused")}
							</SelectItem>
							<SelectItem value="always">
								{t("notifications.always")}
							</SelectItem>
						</SelectContent>
					</Select>
				</SettingsRow>
				<SettingsRow
					label={t("notifications.permissions")}
					description={t("notifications.permissionsDescription")}
				>
					<Switch
						checked={notif.permissions}
						onCheckedChange={(v) => updateNotif("permissions", v)}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("notifications.questions")}
					description={t("notifications.questionsDescription")}
				>
					<Switch
						checked={notif.questions}
						onCheckedChange={(v) => updateNotif("questions", v)}
					/>
				</SettingsRow>
				<SettingsRow
					label={t("notifications.errors")}
					description={t("notifications.errorsDescription")}
				>
					<Switch
						checked={notif.errors}
						onCheckedChange={(v) => updateNotif("errors", v)}
					/>
				</SettingsRow>
				{isMac && (
					<SettingsRow
						label={t("notifications.dockBadge")}
						description={t("notifications.dockBadgeDescription")}
					>
						<Switch
							checked={notif.dockBadge}
							onCheckedChange={(v) => updateNotif("dockBadge", v)}
						/>
					</SettingsRow>
				)}
			</SettingsSection>
		</div>
	);
}
