// Every request goes to the service its model belongs to: the model id says which (models.ts). The
// player chooses a model for each role, so a game can run wholly on Claude, wholly on Venice, wholly on
// NanoGPT, or on a mix; nothing is ever sent to a service the chosen model does not belong to.
import { t } from '../../i18n';
import { SERVICE_NAME, serviceOf, type Service } from './models';
import { LlmError, type Transport } from './transport';

export function byService(transports: Partial<Record<Service, Transport>>): Transport {
  return {
    simulated: false,
    send(req, opts) {
      const service = serviceOf(req.params.model);
      const transport = transports[service];
      // A role whose service has no key: the request is not sent anywhere else.
      if (!transport) {
        return Promise.reject(new LlmError('auth', t('There is no {service} key on this device for the model chosen for this.', { service: SERVICE_NAME[service] }), null, null, service));
      }
      return transport.send(req, opts);
    },
  };
}
