import { ComposeClient } from "./client.ts";
import type { ComposeAgent, ComposeImageOption, ComposeNode } from "./types.ts";

/** List native image references only. Registry credentials and labels stay on the daemon. */
export async function listImages(node: ComposeNode, agents: ComposeAgent[]) {
  const options = new Map<string, ComposeImageOption>();
  for (const agent of agents) {
    if (agent.nodeId !== node.id || agent.provider !== "pi") continue;
    const ref = typeof agent.spec.image === "string" ? agent.spec.image.trim() : "";
    if (ref) options.set(ref, { ref, local: false, usedByPi: true });
  }
  let imagesUnavailable = false;
  try {
    const client = new ComposeClient(node);
    let offset = 0;
    while (true) {
      const page = await client.call<{
        images?: Array<{
          imageRef?: string; repoTags?: string[]; repoDigests?: string[]; dangling?: boolean;
          platform?: { os?: string; architecture?: string; variant?: string };
        }>;
        total?: number;
        storeStatus?: { available?: boolean };
      }>("ImageService", "ListImages", { offset, limit: 500 });
      if (page.storeStatus?.available === false) imagesUnavailable = true;
      for (const image of page.images ?? []) {
        if (image.dangling) continue;
        const refs = image.repoTags?.length ? image.repoTags : image.repoDigests?.length ? image.repoDigests : [image.imageRef];
        for (const value of refs) {
          if (typeof value !== "string" || !value.trim() || value.includes("<none>")) continue;
          const ref = value.trim();
          options.set(ref, {
            ref, local: true, usedByPi: options.get(ref)?.usedByPi ?? false,
            platform: [image.platform?.os, image.platform?.architecture, image.platform?.variant].filter(Boolean).join("/") || undefined,
          });
        }
      }
      offset += page.images?.length ?? 0;
      if (!page.images?.length || offset >= (page.total ?? offset)) break;
    }
  } catch {
    // Older daemons can still reuse an existing Pi image or accept a custom reference.
    imagesUnavailable = true;
  }
  return {
    images: [...options.values()].sort((a, b) => Number(b.usedByPi) - Number(a.usedByPi) || a.ref.localeCompare(b.ref)),
    imagesUnavailable,
  };
}
