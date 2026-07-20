// Canonical TPS Health UI consumer adapter. It intentionally has no private-registry or App-alias fallback.

import type { App, EventRef, Events } from "obsidian";
import {
  parseTPSHealthUiServiceDescriptor,
  TPS_HEALTH_UI_SERVICE_EVENTS,
  TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION,
  type TPSHealthUiApiSnapshot,
  type TPSHealthUiServiceDescriptorSnapshot,
  type TPSHealthUiServiceRequest,
} from "./tps-health-ui-contract";

export type TPSHealthUiAvailabilityChanged = (
  api: Readonly<TPSHealthUiApiSnapshot> | undefined,
) => void;

export class TPSHealthUiClient {
  private descriptor?: Readonly<TPSHealthUiServiceDescriptorSnapshot>;
  private started = false;
  private lifecycleEpoch = 0;
  private availabilityChanged?: TPSHealthUiAvailabilityChanged;
  private lastNotifiedSourceApi?: object;
  private hasNotifiedUnavailable = false;
  private requestSequence = 0;
  private announcementSequence = 0;
  private eventRefs: EventRef[] = [];
  private readonly withdrawnDescriptors = new WeakSet<object>();
  private readonly withdrawnApis = new WeakSet<object>();

  constructor(
    private readonly app: App,
    private readonly consumerPluginId: string,
  ) {}

  start(
    registerEvent: (eventRef: EventRef) => void,
    onAvailabilityChanged?: TPSHealthUiAvailabilityChanged,
  ): void {
    if (this.started) return;
    this.started = true;
    this.availabilityChanged = onAvailabilityChanged;
    const epoch = ++this.lifecycleEpoch;
    const events = this.app.workspace as Events;

    try {
      this.registerOwnedListener(registerEvent, () => events.on(
        TPS_HEALTH_UI_SERVICE_EVENTS.AVAILABLE,
        (...args: unknown[]) => {
          try {
            this.acceptAvailableEvent(args[0], epoch);
          } catch {
            // A malformed or reentrant provider event must not destabilize the consumer.
          }
        },
      ));
      if (!this.isCurrent(epoch)) return;
      this.registerOwnedListener(registerEvent, () => events.on(
        TPS_HEALTH_UI_SERVICE_EVENTS.UNAVAILABLE,
        (...args: unknown[]) => {
          try {
            this.acceptUnavailableEvent(args[0], epoch);
          } catch {
            // Ignore malformed or reentrant lifecycle announcements.
          }
        },
      ));
    } catch (error) {
      this.rollbackFailedStart(epoch);
      throw error;
    }
    if (!this.isCurrent(epoch)) return;

    this.requestCurrentDescriptor(epoch);
    this.notifyAvailability();
  }

  dispose(): void {
    if (!this.started) return;
    const callback = this.availabilityChanged;
    const shouldNotifyUnavailable = !!this.descriptor || !this.hasNotifiedUnavailable;
    const eventRefs = this.eventRefs;
    this.eventRefs = [];
    this.lifecycleEpoch += 1;
    this.requestSequence += 1;
    this.started = false;
    this.descriptor = undefined;
    this.availabilityChanged = undefined;
    this.lastNotifiedSourceApi = undefined;
    this.hasNotifiedUnavailable = false;
    for (const eventRef of eventRefs) {
      try {
        this.app.workspace.offref(eventRef);
      } catch {
        // Epoch invalidation above still leaves a failed removal inert.
      }
    }
    if (callback && shouldNotifyUnavailable) {
      try {
        callback(undefined);
      } catch {
        // Disposal must complete even if the prior consumer callback fails.
      }
    }
  }

  getApi(): Readonly<TPSHealthUiApiSnapshot> | undefined {
    return this.started ? this.descriptor?.api : undefined;
  }

  private registerOwnedListener(
    registerEvent: (eventRef: EventRef) => void,
    createEventRef: () => EventRef,
  ): void {
    const eventRef = createEventRef();
    this.eventRefs.push(eventRef);
    try {
      registerEvent(eventRef);
    } catch {
      // The client owns and physically removes the ref even if its host owner rejects it.
    }
  }

  private rollbackFailedStart(epoch: number): void {
    if (epoch !== this.lifecycleEpoch) return;
    const eventRefs = this.eventRefs;
    this.eventRefs = [];
    this.lifecycleEpoch += 1;
    this.requestSequence += 1;
    this.started = false;
    this.descriptor = undefined;
    this.availabilityChanged = undefined;
    this.lastNotifiedSourceApi = undefined;
    this.hasNotifiedUnavailable = false;
    for (const eventRef of eventRefs) {
      try {
        this.app.workspace.offref(eventRef);
      } catch {
        // Epoch invalidation above keeps a failed physical removal inert.
      }
    }
  }

  private isCurrent(epoch: number): boolean {
    return this.started && epoch === this.lifecycleEpoch;
  }

  private acceptAvailableEvent(value: unknown, epoch: number): void {
    if (!this.isCurrent(epoch)) return;
    const announcementSequence = this.announcementSequence;
    const descriptor = parseTPSHealthUiServiceDescriptor(value);
    if (!descriptor
      || !this.isCurrent(epoch)
      || announcementSequence !== this.announcementSequence) return;
    this.announcementSequence += 1;
    this.adoptDescriptor(descriptor, epoch);
  }

  private acceptUnavailableEvent(value: unknown, epoch: number): void {
    if (!this.isCurrent(epoch)) return;
    const current = this.descriptor;
    if (current && value === current.sourceDescriptor) {
      this.rememberWithdrawal(current);
      this.announcementSequence += 1;
      this.withdrawCurrentDescriptor(epoch);
      return;
    }
    const announcementSequence = this.announcementSequence;
    const withdrawn = parseTPSHealthUiServiceDescriptor(value);
    if (!withdrawn
      || !this.isCurrent(epoch)
      || announcementSequence !== this.announcementSequence) return;
    this.withdrawnDescriptors.add(withdrawn.sourceDescriptor);
    this.withdrawnApis.add(withdrawn.api.sourceApi);
    this.announcementSequence += 1;
    const latest = this.descriptor;
    if (!latest
      || (withdrawn.sourceDescriptor !== latest.sourceDescriptor
        && withdrawn.api.sourceApi !== latest.api.sourceApi)) return;
    this.rememberWithdrawal(latest);
    this.withdrawCurrentDescriptor(epoch);
  }

  private withdrawCurrentDescriptor(epoch: number): void {
    if (!this.isCurrent(epoch) || !this.descriptor) return;
    this.descriptor = undefined;
    this.notifyAvailability();
  }

  private rememberWithdrawal(
    descriptor: Readonly<TPSHealthUiServiceDescriptorSnapshot>,
  ): void {
    this.withdrawnDescriptors.add(descriptor.sourceDescriptor);
    this.withdrawnApis.add(descriptor.api.sourceApi);
  }

  private adoptDescriptor(
    descriptor: Readonly<TPSHealthUiServiceDescriptorSnapshot>,
    epoch: number,
  ): boolean {
    if (!this.isCurrent(epoch)) return false;
    if (this.withdrawnDescriptors.has(descriptor.sourceDescriptor)
      || this.withdrawnApis.has(descriptor.api.sourceApi)) return false;
    if (this.descriptor?.sourceDescriptor === descriptor.sourceDescriptor
      || this.descriptor?.api.sourceApi === descriptor.api.sourceApi) return true;
    this.descriptor = descriptor;
    this.notifyAvailability();
    return this.isCurrent(epoch)
      && (this.descriptor?.sourceDescriptor === descriptor.sourceDescriptor
        || this.descriptor?.api.sourceApi === descriptor.api.sourceApi);
  }

  private requestCurrentDescriptor(epoch: number): void {
    if (!this.isCurrent(epoch)) return;
    const requestSequence = ++this.requestSequence;
    const announcementSequence = this.announcementSequence;
    let accepting = true;
    let accepted = false;
    const request: TPSHealthUiServiceRequest = Object.freeze({
      protocolVersion: TPS_HEALTH_UI_SERVICE_PROTOCOL_VERSION,
      consumerPluginId: this.consumerPluginId,
      accept: (value: unknown) => {
        try {
          if (!accepting
            || accepted
            || requestSequence !== this.requestSequence
            || announcementSequence !== this.announcementSequence
            || !this.isCurrent(epoch)) return;
          const descriptor = parseTPSHealthUiServiceDescriptor(value);
          if (!descriptor
            || !this.isCurrent(epoch)
            || requestSequence !== this.requestSequence
            || announcementSequence !== this.announcementSequence) return;
          accepted = this.adoptDescriptor(descriptor, epoch);
        } catch {
          // Ignore delayed, malformed, or hostile provider callbacks.
        }
      },
    });
    try {
      this.app.workspace.trigger(TPS_HEALTH_UI_SERVICE_EVENTS.REQUEST, request);
    } catch {
      // Preserve a previously validated descriptor if another request listener throws.
    } finally {
      accepting = false;
    }
  }

  private notifyAvailability(): void {
    const callback = this.availabilityChanged;
    if (!callback) return;
    const api = this.descriptor?.api;
    if (api) {
      if (this.lastNotifiedSourceApi === api.sourceApi) return;
      this.lastNotifiedSourceApi = api.sourceApi;
      this.hasNotifiedUnavailable = false;
    } else {
      if (this.hasNotifiedUnavailable && this.lastNotifiedSourceApi === undefined) return;
      this.lastNotifiedSourceApi = undefined;
      this.hasNotifiedUnavailable = true;
    }
    try {
      callback(api);
    } catch {
      // Consumer callbacks are isolated from discovery and other listeners.
    }
  }
}
