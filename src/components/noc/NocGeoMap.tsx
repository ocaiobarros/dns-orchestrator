// ============================================================
// DNS Control — Geographic Network Map (OpenStreetMap + Leaflet)
// Shows resolvers, VIPs, and upstreams on a real-world map
// with animated connection lines and live telemetry overlays.
// ============================================================

import { useEffect, useRef, useMemo } from 'react';
import { MapContainer, TileLayer, CircleMarker, Polyline, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import type { MapNode, MapEdge } from './NocNetworkMap';
import { AnimatePresence, motion } from 'framer-motion';

// Fix default marker icons in bundled environments
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface GeoNode extends MapNode {
  lat?: number;
  lng?: number;
}

interface Props {
  nodes: MapNode[];
  edges: MapEdge[];
  title?: string;
  /** Server lat/lng — if not set, defaults to São Paulo */
  serverLat?: number;
  serverLng?: number;
}

// Known upstream DNS geo locations
const KNOWN_UPSTREAMS: Record<string, { lat: number; lng: number; label: string }> = {
  '8.8.8.8': { lat: 37.386, lng: -122.084, label: 'Google DNS (US)' },
  '8.8.4.4': { lat: 37.386, lng: -122.084, label: 'Google DNS (US)' },
  '1.1.1.1': { lat: 34.053, lng: -118.244, label: 'Cloudflare (US)' },
  '1.0.0.1': { lat: 34.053, lng: -118.244, label: 'Cloudflare (US)' },
  '9.9.9.9': { lat: 37.774, lng: -122.419, label: 'Quad9 (US)' },
  '208.67.222.222': { lat: 37.386, lng: -122.084, label: 'OpenDNS (US)' },
  '208.67.220.220': { lat: 37.386, lng: -122.084, label: 'OpenDNS (US)' },
  '172.217.29.206': { lat: 37.386, lng: -122.084, label: 'Google Upstream' },
};

// Simulated client access points (represent regional DNS traffic origins)
const CLIENT_ACCESS_POINTS = [
  { lat: -23.55, lng: -46.63, label: 'São Paulo', qps: 320 },
  { lat: -22.91, lng: -43.17, label: 'Rio de Janeiro', qps: 180 },
  { lat: -19.92, lng: -43.94, label: 'Belo Horizonte', qps: 95 },
  { lat: -25.43, lng: -49.27, label: 'Curitiba', qps: 72 },
  { lat: -30.03, lng: -51.23, label: 'Porto Alegre', qps: 68 },
  { lat: -15.78, lng: -47.93, label: 'Brasília', qps: 55 },
  { lat: -12.97, lng: -38.51, label: 'Salvador', qps: 48 },
  { lat: -3.72, lng: -38.52, label: 'Fortaleza', qps: 35 },
  { lat: -8.05, lng: -34.87, label: 'Recife', qps: 30 },
  { lat: -2.50, lng: -44.28, label: 'São Luís', qps: 18 },
];

function getStatusColor(status: string): string {
  switch (status) {
    case 'ok': return '#22c55e';
    case 'degraded': return '#f59e0b';
    case 'failed': return '#ef4444';
    case 'inactive': return '#6b7280';
    default: return '#6b7280';
  }
}

function getLatencyColor(ms?: number): string {
  if (ms == null) return '#6b7280';
  if (ms < 30) return '#22c55e';
  if (ms < 100) return '#f59e0b';
  return '#ef4444';
}

/** Auto-fit map bounds to all markers */
function FitBounds({ positions }: { positions: [number, number][] }) {
  const map = useMap();
  const fitted = useRef(false);

  useEffect(() => {
    if (positions.length > 0 && !fitted.current) {
      const bounds = L.latLngBounds(positions.map(([lat, lng]) => [lat, lng]));
      map.fitBounds(bounds, { padding: [50, 50], maxZoom: 6 });
      fitted.current = true;
    }
  }, [positions, map]);

  return null;
}

/** Pulsing animation ring */
function PulseRing({ center, color, radius }: { center: [number, number]; color: string; radius: number }) {
  const map = useMap();
  const ringRef = useRef<L.CircleMarker | null>(null);

  useEffect(() => {
    const ring = L.circleMarker(center, {
      radius,
      color,
      fillColor: color,
      fillOpacity: 0.15,
      weight: 1,
      opacity: 0.4,
      className: 'noc-geo-pulse',
    }).addTo(map);
    ringRef.current = ring;
    return () => { ring.remove(); };
  }, [center, color, radius, map]);

  return null;
}

export default function NocGeoMap({
  nodes,
  edges,
  title = 'DNS Network Map',
  serverLat = -23.55,
  serverLng = -46.63,
}: Props) {
  // Assign geo positions to nodes
  const geoNodes = useMemo<GeoNode[]>(() => {
    const result: GeoNode[] = [];
    const resolvers = nodes.filter(n => n.type === 'resolver');
    const vips = nodes.filter(n => n.type === 'vip');
    const upstreams = nodes.filter(n => n.type === 'upstream');

    // VIPs at server location
    vips.forEach(n => {
      result.push({ ...n, lat: serverLat, lng: serverLng });
    });

    // Resolvers slightly offset from server
    resolvers.forEach((n, i) => {
      const offset = 0.15 * (i - (resolvers.length - 1) / 2);
      result.push({ ...n, lat: serverLat + offset, lng: serverLng + offset * 0.8 });
    });

    // Upstreams — try to match known IPs
    upstreams.forEach((n, i) => {
      const ip = n.bindIp || n.extra || '';
      const known = Object.entries(KNOWN_UPSTREAMS).find(([k]) => ip.includes(k));
      if (known) {
        result.push({ ...n, lat: known[1].lat, lng: known[1].lng });
      } else {
        // Default upstream positions spread globally
        const defaultPositions = [
          { lat: 37.386, lng: -122.084 },
          { lat: 51.507, lng: -0.128 },
          { lat: 35.681, lng: 139.767 },
        ];
        const pos = defaultPositions[i % defaultPositions.length];
        result.push({ ...n, lat: pos.lat, lng: pos.lng });
      }
    });

    return result;
  }, [nodes, serverLat, serverLng]);

  // All positions for fit bounds
  const allPositions = useMemo<[number, number][]>(() => {
    const pts: [number, number][] = geoNodes
      .filter(n => n.lat != null && n.lng != null)
      .map(n => [n.lat!, n.lng!]);
    CLIENT_ACCESS_POINTS.forEach(c => pts.push([c.lat, c.lng]));
    return pts;
  }, [geoNodes]);

  // Total QPS for scaling
  const totalQps = useMemo(() => {
    return nodes.reduce((sum, n) => sum + (n.qps || 0), 0);
  }, [nodes]);

  const hasIssues = nodes.some(n => n.status === 'failed' || n.status === 'degraded');

  return (
    <div className="noc-surface overflow-hidden">
      <div className="noc-surface-header flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
          <span className="text-[11px] font-mono font-bold tracking-widest uppercase text-foreground/80">{title}</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/40">
            <span className="w-2 h-2 rounded-full bg-success" /> Healthy
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/40">
            <span className="w-2 h-2 rounded-full bg-destructive" /> Failed
          </span>
          <span className="flex items-center gap-1.5 text-[9px] font-mono text-muted-foreground/40">
            <span className="w-2 h-2 rounded-full bg-accent opacity-50" /> Client
          </span>
          <span className="text-[9px] font-mono text-muted-foreground/20 uppercase tracking-widest">
            Live Geo Topology
          </span>
        </div>
      </div>

      <div className="relative w-full" style={{ height: 500 }}>
        <MapContainer
          center={[serverLat, serverLng]}
          zoom={4}
          style={{ height: '100%', width: '100%', background: 'hsl(225, 30%, 5%)' }}
          zoomControl={false}
          attributionControl={false}
        >
          {/* Dark tile layer — CartoDB Dark Matter */}
          <TileLayer
            url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
          />

          <FitBounds positions={allPositions} />

          {/* Client access points — small cyan dots with traffic lines */}
          {CLIENT_ACCESS_POINTS.map(client => {
            const scaledRadius = Math.max(3, Math.min(10, client.qps / 40));
            return (
              <CircleMarker
                key={client.label}
                center={[client.lat, client.lng]}
                radius={scaledRadius}
                pathOptions={{
                  color: 'hsl(190, 90%, 50%)',
                  fillColor: 'hsl(190, 90%, 50%)',
                  fillOpacity: 0.35,
                  weight: 1,
                  opacity: 0.6,
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#e2e8f0', background: '#0f172a', padding: 8, borderRadius: 6, border: '1px solid #1e293b', minWidth: 140 }}>
                    <div style={{ fontWeight: 700, marginBottom: 4 }}>{client.label}</div>
                    <div style={{ color: '#94a3b8' }}>QPS: <span style={{ color: '#22d3ee' }}>{client.qps}</span></div>
                    <div style={{ color: '#94a3b8', fontSize: 9 }}>DNS Client Region</div>
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}

          {/* Lines from clients to VIP/resolver cluster */}
          {CLIENT_ACCESS_POINTS.map(client => (
            <Polyline
              key={`line-${client.label}`}
              positions={[[client.lat, client.lng], [serverLat, serverLng]]}
              pathOptions={{
                color: 'hsl(190, 90%, 50%)',
                weight: Math.max(1, client.qps / 100),
                opacity: 0.15,
                dashArray: '4 8',
              }}
            />
          ))}

          {/* Edge connections between nodes */}
          {edges.map(edge => {
            const from = geoNodes.find(n => n.id === edge.from);
            const to = geoNodes.find(n => n.id === edge.to);
            if (!from?.lat || !to?.lat || !from?.lng || !to?.lng) return null;
            const color = getLatencyColor(edge.latency);
            const weight = Math.max(2, Math.min(6, (edge.qps || 0) / 200 + 2));
            return (
              <Polyline
                key={`${edge.from}-${edge.to}`}
                positions={[[from.lat, from.lng], [to.lat, to.lng]]}
                pathOptions={{
                  color,
                  weight,
                  opacity: 0.6,
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#e2e8f0', background: '#0f172a', padding: 8, borderRadius: 6, border: '1px solid #1e293b' }}>
                    <div>{from.label} → {to.label}</div>
                    {edge.latency != null && <div style={{ color }}>Latency: {edge.latency}ms</div>}
                    {edge.qps != null && <div style={{ color: '#94a3b8' }}>QPS: {edge.qps}</div>}
                  </div>
                </Popup>
              </Polyline>
            );
          })}

          {/* Infrastructure nodes — VIPs, Resolvers, Upstreams */}
          {geoNodes.map(node => {
            if (node.lat == null || node.lng == null) return null;
            const color = getStatusColor(node.status);
            const radius = node.type === 'vip' ? 12 : node.type === 'resolver' ? 10 : 8;

            return (
              <CircleMarker
                key={node.id}
                center={[node.lat, node.lng]}
                radius={radius}
                pathOptions={{
                  color,
                  fillColor: color,
                  fillOpacity: 0.7,
                  weight: 2,
                  opacity: 1,
                }}
              >
                <Popup>
                  <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: '#e2e8f0', background: '#0f172a', padding: 10, borderRadius: 8, border: '1px solid #1e293b', minWidth: 160 }}>
                    <div style={{ fontWeight: 800, fontSize: 12, marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color, display: 'inline-block' }} />
                      {node.label}
                    </div>
                    <div style={{ color: '#64748b', fontSize: 9, textTransform: 'uppercase', letterSpacing: 1, marginBottom: 4 }}>
                      {node.type}
                    </div>
                    {node.bindIp && <div style={{ color: '#94a3b8' }}>IP: <span style={{ color: '#22d3ee' }}>{node.bindIp}</span></div>}
                    {node.qps != null && <div style={{ color: '#94a3b8' }}>QPS: <span style={{ color: '#22c55e' }}>{node.qps}</span></div>}
                    {node.latency != null && (
                      <div style={{ color: '#94a3b8' }}>
                        Latency: <span style={{ color: getLatencyColor(node.latency) }}>{node.latency}ms</span>
                      </div>
                    )}
                    {node.cacheHit != null && <div style={{ color: '#94a3b8' }}>Cache: <span style={{ color: '#22c55e' }}>{node.cacheHit}%</span></div>}
                    {node.extra && <div style={{ color: '#64748b', fontSize: 9, marginTop: 4 }}>{node.extra}</div>}
                  </div>
                </Popup>
              </CircleMarker>
            );
          })}
        </MapContainer>

        {/* Incident overlay */}
        <AnimatePresence>
          {hasIssues && (
            <motion.div
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              className="absolute top-3 right-3 z-[1000] px-3 py-2 rounded-lg border border-destructive/30 bg-destructive/10 backdrop-blur-md"
            >
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 rounded-full bg-destructive animate-pulse" />
                <span className="text-[10px] font-mono font-bold text-destructive/90">
                  {nodes.filter(n => n.status === 'failed').length > 0
                    ? `${nodes.filter(n => n.status === 'failed').length} node(s) failed`
                    : `${nodes.filter(n => n.status === 'degraded').length} node(s) degraded`
                  }
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Stats overlay */}
        <div className="absolute bottom-3 left-3 z-[1000] px-3 py-2 rounded-lg border border-border/30 bg-card/80 backdrop-blur-md">
          <div className="flex items-center gap-4 text-[9px] font-mono text-muted-foreground/50">
            <span>Nodes: <span className="text-foreground/70 font-bold">{nodes.length}</span></span>
            <span>Regions: <span className="text-accent font-bold">{CLIENT_ACCESS_POINTS.length}</span></span>
            {totalQps > 0 && <span>Total QPS: <span className="text-primary font-bold">{totalQps}</span></span>}
          </div>
        </div>
      </div>
    </div>
  );
}
