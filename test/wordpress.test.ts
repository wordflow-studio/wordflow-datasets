import { expect, test } from 'bun:test'

import { createWordPressRestTransport } from '../src/index.ts'

test('createWordPressRestTransport sends the configured password via basic auth', async () => {
  const requests: Request[] = []
  const fetchImpl = (async (input: string | URL | Request, init?: RequestInit) => {
    if (input instanceof Request) {
      requests.push(new Request(input, init))
    } else {
      requests.push(new Request(input.toString(), init))
    }

    return new Response(JSON.stringify([]), {
      headers: {
        'Content-Type': 'application/json',
      },
      status: 200,
    })
  }) as typeof fetch

  const transport = createWordPressRestTransport(
    {
      baseUrl: 'https://example.com/wordpress',
      password: 'password',
      username: 'admin',
    },
    fetchImpl,
  )

  await transport.upsertTerm({
    name: 'Community',
    slug: 'community',
    taxonomy: 'category',
  })

  expect(requests).toHaveLength(2)
  expect(requests[0]?.headers.get('Authorization')).toBe(`Basic ${Buffer.from('admin:password').toString('base64')}`)
  expect(requests[1]?.headers.get('Authorization')).toBe(`Basic ${Buffer.from('admin:password').toString('base64')}`)
})

test('createWordPressRestTransport allows loopback http urls', () => {
  expect(() =>
    createWordPressRestTransport({
      baseUrl: 'http://127.0.0.1:9400',
      password: 'password',
      username: 'admin',
    }),
  ).not.toThrow()
})

test('createWordPressRestTransport rejects non-loopback http urls', () => {
  expect(() =>
    createWordPressRestTransport({
      baseUrl: 'http://example.com/wordpress',
      password: 'password',
      username: 'admin',
    }),
  ).toThrow(
    'Authenticated WordPress requests require HTTPS unless WORDPRESS_ENDPOINT uses localhost, 127.0.0.1, or ::1: http://example.com/wordpress',
  )
})

test('createWordPressRestTransport surfaces redirect guidance for playground login mode', async () => {
  const transport = createWordPressRestTransport(
    {
      baseUrl: 'http://127.0.0.1:9400',
      password: 'password',
      username: 'admin',
    },
    (async () =>
      new Response(null, {
        headers: {
          location: '/wp-json/wp/v2/categories?slug=community',
        },
        status: 302,
        statusText: 'Found',
      })) as unknown as typeof fetch,
  )

  await expect(
    transport.upsertTerm({
      name: 'Community',
      slug: 'community',
      taxonomy: 'category',
    }),
  ).rejects.toThrow(
    'WordPress request redirected unexpectedly: 302 Found -> /wp-json/wp/v2/categories?slug=community. Unexpected redirect during authenticated REST access. If you are using WordPress Playground, start it without `--login` for API clients.',
  )
})

test('createWordPressRestTransport surfaces 401 auth guidance', async () => {
  const transport = createWordPressRestTransport(
    {
      baseUrl: 'http://127.0.0.1:9400',
      password: 'password',
      username: 'admin',
    },
    (async () =>
      new Response(
        JSON.stringify({
          code: 'rest_cannot_create',
          message: 'Sorry, you are not allowed to create terms in this taxonomy.',
        }),
        {
          headers: {
            'Content-Type': 'application/json',
          },
          status: 401,
          statusText: 'Unauthorized',
        },
      )) as unknown as typeof fetch,
  )

  await expect(
    transport.upsertTerm({
      name: 'Community',
      slug: 'community',
      taxonomy: 'category',
    }),
  ).rejects.toThrow(
    'WordPress request failed: 401 Unauthorized. Basic Auth write requests usually require a WordPress application password unless the target explicitly accepts normal passwords. Response: {"code":"rest_cannot_create","message":"Sorry, you are not allowed to create terms in this taxonomy."}',
  )
})
