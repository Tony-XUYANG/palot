/**
 * Localized model error notice with redacted, collapsible provider details.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
	formatModelError,
	getModelErrorTechnicalDetails,
	type ModelError,
} from "../../lib/model-errors";

interface ModelErrorNoticeProps {
	error: ModelError;
}

export function ModelErrorNotice({ error }: ModelErrorNoticeProps) {
	const { t, i18n } = useTranslation();
	const message = useMemo(() => formatModelError(error), [error, i18n.language]);
	const details = useMemo(() => getModelErrorTechnicalDetails(error), [error]);

	return (
		<div
			className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-400"
			role="alert"
		>
			<p>{message}</p>
			{details && details !== message ? (
				<details className="mt-1.5 text-red-400/80">
					<summary className="cursor-pointer select-none font-medium">
						{t("common.errors.technicalDetails")}
					</summary>
					<pre className="mt-1.5 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-background/50 p-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
						{details}
					</pre>
				</details>
			) : null}
		</div>
	);
}
