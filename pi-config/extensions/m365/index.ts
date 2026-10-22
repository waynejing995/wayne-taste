/**
 * Microsoft 365 for pi and omp: Teams and Outlook in one package.
 *
 * Each half registers its own tools, commands and status-bar part; what they
 * share -- the sign-in, the Graph client, people search, SharePoint downloads,
 * file saving, picture descriptions, the @mention syntax -- lives in core/.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import outlook from "./outlook/index.ts";
import teams from "./teams/index.ts";

export default function (pi: ExtensionAPI) {
	teams(pi);
	outlook(pi);
}
