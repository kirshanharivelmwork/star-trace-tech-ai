"use client"

import { useCallback, useState } from "react"

import { AbstractHistory } from "@/components/dashboard/abstract-history"
import { AbstractViewer } from "@/components/dashboard/abstract-viewer"
import {
  LeaseUploader,
  type LeaseAnalysisState,
} from "@/components/dashboard/lease-uploader"
import type { LeaseAbstractRecord } from "@/app/api/lease/schema"

const IDLE_STATE: LeaseAnalysisState = {
  fileName: null,
  object: undefined,
  isLoading: false,
  error: null,
}

/**
 * Owns the shared state for the Commercial Lease Abstractor feature:
 * - The live/streaming analysis result from LeaseUploader.
 * - Which past lease (if any) is currently selected from AbstractHistory.
 * - A refresh counter so AbstractHistory re-fetches once a new analysis is
 *   persisted server-side, making it appear immediately.
 */
export const LeaseWorkspace = () => {
  const [analysis, setAnalysis] = useState<LeaseAnalysisState>(IDLE_STATE)
  const [selectedRecord, setSelectedRecord] =
    useState<LeaseAbstractRecord | null>(null)
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0)

  const handleStateChange = useCallback((state: LeaseAnalysisState) => {
    setAnalysis(state)
    // A fresh upload/analysis takes over the viewer from whatever past
    // abstract might currently be selected.
    if (state.fileName) {
      setSelectedRecord(null)
    }
  }, [])

  const handleAnalysisComplete = useCallback(() => {
    setHistoryRefreshKey((key) => key + 1)
  }, [])

  const handleSelectHistoryRecord = useCallback(
    (record: LeaseAbstractRecord) => {
      setSelectedRecord(record)
      setAnalysis(IDLE_STATE)
    },
    []
  )

  const viewerAbstract = selectedRecord
    ? selectedRecord.abstract_data
    : analysis.object
  const viewerFileName = selectedRecord
    ? selectedRecord.file_name
    : analysis.fileName
  const isViewerLoading = !selectedRecord && analysis.isLoading
  const viewerError = selectedRecord ? null : analysis.error
  const showViewer = Boolean(viewerFileName) || isViewerLoading

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      <AbstractHistory
        refreshKey={historyRefreshKey}
        selectedId={selectedRecord?.id ?? null}
        onSelect={handleSelectHistoryRecord}
      />

      <div className="flex flex-col gap-4">
        <LeaseUploader
          onStateChange={handleStateChange}
          onAnalysisComplete={handleAnalysisComplete}
        />

        {showViewer ? (
          <AbstractViewer
            abstract={viewerAbstract}
            fileName={viewerFileName}
            isLoading={isViewerLoading}
            errorMessage={viewerError}
          />
        ) : null}
      </div>
    </div>
  )
}
