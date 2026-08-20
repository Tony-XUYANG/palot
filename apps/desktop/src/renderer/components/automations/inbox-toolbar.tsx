/**
 * Toolbar header for the automations left panel.
 *
 * Shows "Automations" title with "Beta" badge, filter icon (placeholder),
 * and "+ New" button.
 */

import { Button } from "@palot/ui/components/button";
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@palot/ui/components/tooltip";
import { FilterIcon, PlusIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

interface InboxToolbarProps {
	onNewClick: () => void;
}

export function InboxToolbar({ onNewClick }: InboxToolbarProps) {
	const { t } = useTranslation();
	return (
		<div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
			<h1 className="text-sm font-semibold">{t("automations.title")}</h1>

			<div className="ml-auto flex items-center gap-1">
				<Tooltip>
					<TooltipTrigger
						render={
							<Button variant="ghost" size="icon" className="size-7" disabled />
						}
					>
						<FilterIcon className="size-3.5" />
						<span className="sr-only">{t("common.ui.filter")}</span>
					</TooltipTrigger>
					<TooltipContent>{t("automations.filter")}</TooltipContent>
				</Tooltip>

				<Button
					variant="ghost"
					size="sm"
					className="h-7 gap-1 text-xs"
					onClick={onNewClick}
				>
					<PlusIcon className="size-3.5" />
					New
				</Button>
			</div>
		</div>
	);
}
