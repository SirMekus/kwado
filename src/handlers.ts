import type { FieldValues } from 'react-hook-form';
import type { FormHelpers, ResponseHandler, ResponseLike } from './types';

/**
 * Matches responses with a specific HTTP status code.
 *
 * @example
 * ```ts
 * // Apply server-side validation errors to form fields
 * whenStatusCode(422, (res, { setError }) => doSomething(res.data, setError))
 *
 * // Handle session expiry
 * whenStatusCode(401, () => router.push('/login'))
 * ```
 */
export function whenStatusCode<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  code: number,
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return {
    detect: (res) => res.statusCode === code,
    handle,
  };
}

/**
 * Matches when `response.status === 'success'`.
 *
 * @example
 * ```ts
 * whenSuccess((res) => {
 *   toast.success(res.data.message);
 *   router.push('/dashboard');
 * })
 * ```
 */
export function whenSuccess<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return {
    detect: (res) => res.status === 'success',
    handle,
  };
}

/**
 * Matches when `response.status === 'error'`.
 *
 * @example
 * ```ts
 * whenError((res) => toast.error(res.data?.message ?? 'Something went wrong'))
 * ```
 */
export function whenError<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return {
    detect: (res) => res.status === 'error',
    handle,
  };
}

/**
 * Matches responses whose status code falls within a numeric range (inclusive).
 *
 * @example
 * ```ts
 * // Catch all server errors
 * whenStatusRange(500, 599, (res) => reportToSentry(res.data))
 * ```
 */
export function whenStatusRange<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  min: number,
  max: number,
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return {
    detect: (res) => res.statusCode >= min && res.statusCode <= max,
    handle,
  };
}

/**
 * Creates a handler with a fully custom detection predicate.
 * Use when none of the other factories express what you need.
 *
 * @example
 * ```ts
 * whenResponse(
 *   (res) => res.data?.type === 'TWO_FACTOR_REQUIRED',
 *   () => router.push('/auth/2fa'),
 * )
 * ```
 */
export function whenResponse<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  detect: (res: ResponseLike<TData>) => boolean,
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return { detect, handle };
}

/**
 * An unconditional catch-all handler. Always fires when placed in the pipeline,
 * so it should be the **last** entry in `responseHandlers`.
 *
 * @example
 * ```ts
 * responseHandlers: [
 *   whenStatusCode(422, applyErrors),
 *   whenSuccess(handleSuccess),
 *   always((_, { reset }) => reset()),   // always clean up
 * ]
 * ```
 */
export function always<
  TData = unknown,
  TForm extends FieldValues = FieldValues,
>(
  handle: (res: ResponseLike<TData>, helpers: FormHelpers<TForm>) => void | Promise<void>,
): ResponseHandler<TData, TForm> {
  return {
    detect: () => true,
    handle,
  };
}
