"use server"

import { revalidatePath } from "next/cache"

import { backfillUnlinkedAbstracts } from "@/lib/lease/hydrate"
import { requireWritableOrg } from "@/lib/org/context"
import type { OrgActionState } from "@/lib/org/actions"
import { createClient } from "@/lib/supabase/server"

export const backfillUnlinkedAbstractsAction =
  async (): Promise<OrgActionState> => {
    try {
      const org = await requireWritableOrg()
      const supabase = await createClient()
      const result = await backfillUnlinkedAbstracts({
        supabase,
        userId: org.userId,
        organizationId: org.orgId,
      })
      revalidatePath("/app")
      revalidatePath("/customers")
      revalidatePath("/finances")
      revalidatePath("/enterprise")
      return {
        ok: true,
        message: `Processed ${result.processed} abstract(s); linked ${result.linked}.`,
      }
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Backfill failed.",
      }
    }
  }
