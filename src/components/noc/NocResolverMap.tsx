// Picks between the two real-data maps based on resolver mode:
//   - FORWARD mode (simples/legacy): a fixed set of forward-addrs exists;
//     show NocUpstreamMap (PoP + rtt per upstream).
//   - ITERATIVE mode (interceptação iterativa): no forward-addrs; the
//     resolver contacts authoritatives/CDNs directly. Show NocCdnMap
//     (live dump_infra aggregate).
//
// Detection is honest and runtime-only: query the upstream snapshot,
// if it has any upstreams use the forward map; otherwise use the CDN map.
// No build-time mode flag → both modes keep working without redeploys.

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import NocUpstreamMap from './NocUpstreamMap';
import NocCdnMap from './NocCdnMap';
import type { UpstreamProbeSnapshot } from '@/lib/types';

export default function NocResolverMap() {
  // Cheap, cached — same query the forward map already issues, so it's free.
  const { data, isLoading } = useQuery({
    queryKey: ['network', 'upstreams'],
    queryFn: api.getUpstreamProbes,
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const snap = (data?.success ? data.data : undefined) as UpstreamProbeSnapshot | undefined;
  const hasForwardUpstreams = (snap?.upstreams?.length ?? 0) > 0;

  // While loading, default to the CDN map: in iterative mode (the new default)
  // there are no upstreams and we'd otherwise flash the wrong map.
  if (isLoading) return <NocCdnMap />;
  return hasForwardUpstreams ? <NocUpstreamMap /> : <NocCdnMap />;
}
