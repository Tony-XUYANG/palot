/**
 * Onboarding Step 1: Welcome.
 *
 * Brief introduction to Palot and what the setup will cover.
 */

import { Button } from "@palot/ui/components/button";
import { ArrowRightIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PalotWordmark } from "../../palot-wordmark";

interface WelcomeStepProps {
	onContinue: () => void;
}

export function WelcomeStep({ onContinue }: WelcomeStepProps) {
	const { t } = useTranslation("onboarding");
	return (
		<div className="flex h-full flex-col items-center justify-center px-6">
			<div className="w-full max-w-md space-y-8 text-center">
				{/* Logo */}
				<div className="flex justify-center">
					<PalotWordmark className="h-6 w-auto text-foreground" />
				</div>

				{/* Description */}
				<div className="space-y-3">
					<p className="text-lg text-muted-foreground">
						{t("welcome.tagline")}
					</p>
					<p className="text-sm leading-relaxed text-muted-foreground/70">
						{t("welcome.body")}
					</p>
				</div>

				{/* CTA */}
				<div className="space-y-3">
					<Button size="lg" onClick={onContinue} className="gap-2">
						{t("welcome.getStarted")}
						<ArrowRightIcon aria-hidden="true" className="size-4" />
					</Button>
					<p className="text-xs text-muted-foreground/50">
						{t("welcome.lessThanMinute")}
					</p>
				</div>
			</div>
		</div>
	);
}
