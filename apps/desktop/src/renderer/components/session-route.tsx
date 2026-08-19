/**
 * Route component for /project/$projectSlug/session/$sessionId.
 *
 * Thin wrapper that extracts the sessionId from route params and delegates
 * to SessionView, which contains all the session orchestration logic.
 */

import { useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { SessionView } from "./session-view";

export function SessionRoute() {
	const { t } = useTranslation();
	const { sessionId } = useParams({ strict: false }) as {
		sessionId?: string;
		projectSlug?: string;
	};

	if (!sessionId) {
		return (
			<div className="flex h-full items-center justify-center">
				<p className="text-sm text-muted-foreground">
					{t("common.errors.noSession")}
				</p>
			</div>
		);
	}

	return <SessionView sessionId={sessionId} />;
}
