import { ChatLogService } from './chat-log.service';

describe('ChatLogService', () => {
  const query = jest.fn();
  let service: ChatLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ChatLogService({ get: jest.fn() } as never);
    (service as unknown as { pool: unknown }).pool = { query };
  });

  it('stores customer messages with the sender as user id', async () => {
    await service.record({
      event_name: 'user_send_text',
      sender: { id: 'customer-1' },
      recipient: { id: 'oa-1' },
      message: { msg_id: 'm1', text: 'Xin chào' },
      timestamp: '1761800000000',
    });

    const [, params] = query.mock.calls[0];
    expect(params.slice(0, 5)).toEqual([
      'm1',
      'customer-1',
      'in',
      'user_send_text',
      'Xin chào',
    ]);
    expect(params[7]).toEqual(new Date(1761800000000));
  });

  it('stores OA replies with the recipient as user id', async () => {
    await service.record({
      event_name: 'oa_send_text',
      sender: { id: 'oa-1' },
      recipient: { id: 'customer-1' },
      message: { msg_id: 'm2', text: 'Dạ em chào anh/chị' },
      timestamp: '1761800001000',
    });

    const [, params] = query.mock.calls[0];
    expect(params.slice(1, 3)).toEqual(['customer-1', 'out']);
  });

  it('skips non-message events', async () => {
    await service.record({ event_name: 'follow', follower: { id: 'c1' } });

    expect(query).not.toHaveBeenCalled();
  });

  it('does not throw when the insert fails', async () => {
    query.mockRejectedValueOnce(new Error('db down'));

    await expect(
      service.record({
        event_name: 'user_send_text',
        sender: { id: 'customer-1' },
        message: { msg_id: 'm3', text: 'hi' },
      }),
    ).resolves.toBeUndefined();
  });
});
