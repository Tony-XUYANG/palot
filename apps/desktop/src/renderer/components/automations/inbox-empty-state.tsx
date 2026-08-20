/**
 * Empty state for the right panel when no automation run is selected.
 *
 * Shows unread count if there are unread runs, or a create CTA if no automations exist.
 */

import { Button } from "@palot/ui/components/button";
import { PlusIcon, SmileIcon, ZapIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useAutomations, useUnreadRunCount } from "../../hooks/use-automations";

interface InboxEmptyStateProps {
	onNewClick?: () => void;
}

export function InboxEmptyState({ onNewClick }: InboxEmptyStateProps) {
	const { t } = useTranslation();
	const automations = useAutomations();
	const unreadCount = useUnreadRunCount();

	const hasAutomations = automations.length > 0;

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-8">
			<div className="flex size-16 items-center justify-center rounded-2xl bg-muted">
				{hasAutomations ? (
					<SmileIcon className="size-8 text-muted-foreground" />
				) : (
					<ZapIcon className="size-8 text-muted-foreground" />
				)}
			</div>

			<div className="space-y-1 text-center">
				{hasAutomations ? (
					<p className="text-sm text-muted-foreground">
						{unreadCount > 0
							? t("automations.unread", { count: unreadCount })
							: t("automations.noUnread")}
					</p>
				) : (
					<>
						<h2 className="text-lg font-semibold">{t("automations.title")}</h2>
						<p className="text-sm text-muted-foreground">
							{t("automations.description")}
						</p>
						{onNewClick && (
							<Button onClick={onNewClick} size="sm" className="mt-3">
								<PlusIcon className="size-4" />
								{t("automations.create")}
							</Button>
						)}
					</>
				)}
			</div>
		</div>
	);
}
