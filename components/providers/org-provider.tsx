"use client"

import { createContext, useContext, type ReactNode } from "react"

import type { OrgContext } from "@/lib/org/types"

const OrgStateContext = createContext<OrgContext | null>(null)

export const OrgProvider = ({
  value,
  children,
}: {
  value: OrgContext | null
  children: ReactNode
}) => (
  <OrgStateContext.Provider value={value}>{children}</OrgStateContext.Provider>
)

export const useOrg = () => useContext(OrgStateContext)
