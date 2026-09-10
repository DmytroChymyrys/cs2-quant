"use client";
import type { CatalogPresentation } from "@/lib/catalog/model";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ReactNode,
} from "react";
const ImageContext = createContext(false);
export function AssetImagesProvider({
  configuredEnabled,
  initiallyEnabled = false,
  children,
}: {
  configuredEnabled: boolean;
  initiallyEnabled?: boolean;
  children: ReactNode;
}) {
  const [healthy, setHealthy] = useState(initiallyEnabled);
  useEffect(() => {
    if (!configuredEnabled) return;
    let stopped = false;
    let controller: AbortController | undefined;
    const refresh = async () => {
      controller = new AbortController();
      const timer = setTimeout(() => controller?.abort(), 12000);
      try {
        const response = await fetch("/api/asset-images/status", {
          cache: "no-store",
          signal: controller.signal,
        });
        const state = await response.json();
        if (!stopped)
          setHealthy(response.ok && state.effectiveEnabled === true);
      } catch {
        if (!stopped) setHealthy(false);
      } finally {
        clearTimeout(timer);
      }
    };
    // Initial HTML already includes the server's cached health decision.
    // Poll only for subsequent circuit-breaker changes.
    const interval = setInterval(() => void refresh(), 60000);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(interval);
    };
  }, [configuredEnabled]);
  return (
    <ImageContext.Provider value={configuredEnabled && healthy}>
      {children}
    </ImageContext.Provider>
  );
}
export function AssetImage({
  name,
  media,
  large = false,
}: {
  name: string;
  media?: CatalogPresentation["media"];
  large?: boolean;
}) {
  const enabled = useContext(ImageContext);
  return enabled && media ? (
    <LoadedAssetImage
      key={`${name}:${media.url}`}
      name={name}
      src={media.url}
      large={large}
    />
  ) : null;
}
function LoadedAssetImage({
  name,
  src,
  large,
}: {
  name: string;
  src: string;
  large: boolean;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const [loaded, setLoaded] = useState<string | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete) {
      if (image.naturalWidth > 0) setLoaded(name);
      else setFailed(name);
    }
  }, [name]);

  // The well exists in server HTML and remains stable through loading/failure.
  return (
    <AssetImageWell large={large}>
      {failed !== name && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          ref={imageRef}
          src={src}
          referrerPolicy="no-referrer"
          alt=""
          aria-hidden="true"
          width={large ? 160 : 44}
          height={large ? 104 : 36}
          decoding="async"
          loading={large ? "eager" : "lazy"}
          fetchPriority={large ? "high" : "auto"}
          className={`optional-asset-image${large ? " large" : ""}`}
          style={{ opacity: loaded === name ? 1 : 0 }}
          onLoad={() => setLoaded(name)}
          onError={() => setFailed(name)}
        />
      )}
    </AssetImageWell>
  );
}

export function AssetImageWell({
  large = false,
  children,
}: {
  large?: boolean;
  children: ReactNode;
}) {
  return (
    <span
      className={`asset-image-well${large ? " large" : ""}`}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
