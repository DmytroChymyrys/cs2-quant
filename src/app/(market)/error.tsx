"use client";
import { Button, DataState } from "@/components/ui";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <DataState
      state="NETWORK_ERROR"
      title="Unable to load this view"
      description="The request could not be completed. Your saved data has not been replaced."
      action={<Button onClick={reset}>Retry request</Button>}
    />
  );
}
