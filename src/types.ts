import type { FieldValues, UseFormReturn } from 'react-hook-form';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * A subset of react-hook-form helpers forwarded to every callback so callers
 * can imperatively update the form without closing over the entire form object.
 */
export type FormHelpers<T extends FieldValues> = Pick<
  UseFormReturn<T>,
  'setValue' | 'setError' | 'reset' | 'getValues' | 'watch' | 'trigger' | 'clearErrors'
>;

/**
 * The normalised response shape that every HTTP call (oku or custom) must
 * resolve to. Mirrors oku's `ResponseObject` contract so the two are
 * interchangeable with no adapter needed.
 */
export interface ResponseLike<TData = unknown> {
  status: 'success' | 'error';
  statusCode: number;
  data: TData;
}

/**
 * A single node in the `responseHandlers` pipeline.
 *
 * Handlers are tested in declaration order; the first one whose `detect`
 * predicate returns `true` has its `handle` method invoked. Subsequent
 * handlers — and the default `onSuccess` / `onError` callbacks — are skipped.
 *
 * Use the exported factory functions (`whenSuccess`, `whenError`,
 * `whenStatusCode`, `whenResponse`, `always`) to build handlers tersely.
 */
export interface ResponseHandler<TData = unknown, TForm extends FieldValues = FieldValues> {
  /** Return `true` when this handler should own the response. */
  detect: (response: ResponseLike<TData>) => boolean;
  /** Process the response. May be async. */
  handle: (
    response: ResponseLike<TData>,
    helpers: FormHelpers<TForm>,
  ) => void | Promise<void>;
}

export interface UseZodFormOptions<TForm extends FieldValues, TResponse = unknown> {
  /**
   * Target URL for the built-in oku HTTP call.
   * Ignored when `submit` is provided.
   */
  endpoint?: string;

  /**
   * HTTP method forwarded to oku. Defaults to `'POST'`.
   * Ignored when `submit` is provided.
   */
  method?: HttpMethod;

  /** Initial / default form field values. */
  defaultValues?: Partial<TForm>;

  /**
   * Map validated form data to the outgoing payload before submission.
   * Use this to rename keys, inject computed fields, or strip UI-only state.
   */
  transform?: (data: TForm) => unknown;

  /**
   * Called when `response.status === 'success'` and no `responseHandler` matched.
   */
  onSuccess?: (
    response: ResponseLike<TResponse>,
    helpers: FormHelpers<TForm>,
  ) => void | Promise<void>;

  /**
   * Called when `response.status === 'error'` and no `responseHandler` matched,
   * or when an unhandled exception escapes the submission.
   */
  onError?: (
    error: ResponseLike<TResponse> | unknown,
    helpers: FormHelpers<TForm>,
  ) => void | Promise<void>;

  /**
   * Ordered list of response handlers evaluated before `onSuccess` / `onError`.
   *
   * The first handler whose `detect` predicate returns `true` is executed; the
   * rest of the pipeline (including `onSuccess` / `onError`) is then skipped.
   *
   * @example
   * ```ts
   * responseHandlers: [
   *   whenStatusCode(422, (res, { setError }) => doSomething(res.data, setError)),
   *   whenSuccess((res) => { toast.success(res.data.message); router.push('/your-path'); }),
   *   whenError((res)  => toast.error(res.data?.message ?? 'Something went wrong')),
   * ]
   * ```
   */
  responseHandlers?: ResponseHandler<TResponse, TForm>[];

  /**
   * Replace the HTTP layer entirely.
   *
   * The function receives the (optionally transformed) payload and must return
   * a `ResponseLike` object. `endpoint`, `method`, and `requestOptions` are
   * ignored when this is provided. `onBeforeSubmit` / `onAfterSubmit` still fire.
   *
   * @example
   * ```ts
   * submit: async (payload) => {
   *   const res = await myApiClient.post('/login', payload);
   *   return { status: res.ok ? 'success' : 'error', statusCode: res.status, data: await res.json() };
   * }
   * ```
   */
  submit?: (payload: unknown) => Promise<ResponseLike<TResponse>>;

  /**
   * Extra options forwarded verbatim to the underlying oku call.
   * Pass oku-specific options here (e.g. `headers`, `credentials`).
   * Has no effect when `submit` is provided.
   */
  requestOptions?: Record<string, unknown>;

  /**
   * Called immediately before the submission attempt starts, regardless of
   * whether the built-in oku path or a custom `submit` function is used.
   * Mirrors the intent of oku's `onStart` but scoped to the form lifecycle.
   *
   * Useful for activating a loading indicator outside react-hook-form's own
   * `formState.isSubmitting`.
   */
  onBeforeSubmit?: () => void;

  /**
   * Called after the submission attempt finishes — success, error, or
   * exception — and is always paired with `onBeforeSubmit`.
   */
  onAfterSubmit?: () => void;
}
