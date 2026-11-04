import { pipedrive } from "./pipedrive";
import { slack } from "./slack";
import type { Provider } from "./types";

export const providers: Provider[] = [pipedrive, slack];
