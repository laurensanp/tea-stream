import type { Request } from 'express'

import { getSessionMetadata } from './session-metadata.util'

const CHROME_UA =
	'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'

const GERMAN_IP = '79.211.175.60'

function requestWith(headers: Request['headers'], ip?: string): Request {
	return { headers, ip } as Request
}

describe('getSessionMetadata', () => {
	it('prefers the Cloudflare header over everything else', () => {
		const metadata = getSessionMetadata(
			requestWith(
				{
					'cf-connecting-ip': GERMAN_IP,
					'x-forwarded-for': '8.8.8.8'
				},
				'127.0.0.1'
			),
			CHROME_UA
		)

		expect(metadata.ip).toBe(GERMAN_IP)
	})

	it('takes the first entry when the Cloudflare header is repeated', () => {
		const metadata = getSessionMetadata(
			requestWith({
				'cf-connecting-ip': [GERMAN_IP, '8.8.8.8']
			}),
			CHROME_UA
		)

		expect(metadata.ip).toBe(GERMAN_IP)
	})

	it('falls back to the first X-Forwarded-For entry', () => {
		const metadata = getSessionMetadata(
			requestWith(
				{
					'x-forwarded-for': `${GERMAN_IP}, 10.0.0.1`
				},
				'127.0.0.1'
			),
			CHROME_UA
		)

		expect(metadata.ip).toBe(GERMAN_IP)
	})

	it('falls back to the socket address', () => {
		const metadata = getSessionMetadata(
			requestWith({}, GERMAN_IP),
			CHROME_UA
		)

		expect(metadata.ip).toBe(GERMAN_IP)
	})

	it('always returns a string IP, even with nothing to go on', () => {
		const metadata = getSessionMetadata(requestWith({}), CHROME_UA)

		expect(typeof metadata.ip).toBe('string')
		expect(metadata.ip.length).toBeGreaterThan(0)
	})

	it('resolves the country name through the registered English locale', () => {
		const metadata = getSessionMetadata(
			requestWith({ 'cf-connecting-ip': GERMAN_IP }),
			CHROME_UA
		)

		expect(metadata.location.country).toBe('Germany')
		expect(metadata.location.city).toBe('Leipzig')
		expect(metadata.location.latitude).toBeCloseTo(51.36, 1)
		expect(metadata.location.longitude).toBeCloseTo(12.38, 1)
	})

	it('reports Unknown and zeroed coordinates for an unresolvable IP', () => {
		const metadata = getSessionMetadata(
			requestWith({ 'cf-connecting-ip': '127.0.0.1' }),
			CHROME_UA
		)

		expect(metadata.location).toEqual({
			country: 'Unknown',
			city: 'Unknown',
			latitude: 0,
			longitude: 0
		})
	})

	it('parses the user agent into device information', () => {
		const metadata = getSessionMetadata(
			requestWith({ 'cf-connecting-ip': GERMAN_IP }),
			CHROME_UA
		)

		expect(metadata.device.browser).toBe('Chrome')
		expect(metadata.device.os).toBe('Windows')
		expect(metadata.device.type).toBe('desktop')
	})

	it('reports Unknown device information for an empty user agent', () => {
		const metadata = getSessionMetadata(
			requestWith({ 'cf-connecting-ip': GERMAN_IP }),
			''
		)

		expect(metadata.device).toEqual({
			browser: 'Unknown',
			os: 'Unknown',
			type: 'Unknown'
		})
	})
})
