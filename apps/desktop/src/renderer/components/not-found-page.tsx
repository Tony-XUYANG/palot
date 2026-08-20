import { Button } from "@palot/ui/components/button";
import { useRouter } from "@tanstack/react-router";
import { SearchXIcon } from "lucide-react";
import { useTranslation } from "react-i18next";

export function NotFoundPage() {
	const router = useRouter();
	const { t } = useTranslation();

	return (
		<div className="flex h-full items-center justify-center p-6">
			<div className="w-full max-w-md space-y-6">
				{/* Icon */}
				<div className="flex justify-center">
					<div className="flex size-14 items-center justify-center rounded-full border border-border bg-muted/50">
						<SearchXIcon className="size-7 text-muted-foreground" />
					</div>
				</div>

				{/* Title + message */}
				<div className="text-center">
					<h1 className="text-lg font-semibold text-foreground">
						{t("common.errors.pageNotFound")}
					</h1>
					<p className="mt-2 text-sm leading-relaxed text-muted-foreground">
						{t("common.errors.pageNotFoundDescription")}
					</p>
				</div>

				{/* Actions */}
				<div className="flex items-center justify-center">
					<Button
						variant="outline"
						size="sm"
						onClick={() => router.navigate({ to: "/" })}
					>
						{t("common.actions.goHome")}
					</Button>
				</div>
			</div>
		</div>
	);
}
