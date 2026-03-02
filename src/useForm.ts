import { useMemo } from 'react';
import { useForm as useRHForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { get as okuGet, post as okuPost } from '@sirmekus/oku';
import type { ZodTypeAny, z } from 'zod';
import type { DefaultValues, SubmitHandler } from 'react-hook-form';
import type { FormHelpers, ResponseLike, UseFormOptions } from './types';

/**
 * Combines Zod schema validation, react-hook-form state management, and oku
 * HTTP submission into a single ergonomic hook.
 *
 * The hook eliminates the boilerplate of wiring `zodResolver`, calling
 * `handleSubmit`, inspecting response status, and routing to success / error
 * branches. An ordered `responseHandlers` pipeline lets you express response
 * logic declaratively — handlers are matched in order and the first one that
 * fires short-circuits the rest.
 *
 * @param schema  A Zod schema describing the form's data shape (object, refined, etc.).
 * @param options Submission target, lifecycle hooks, and response handlers.
 *
 * @returns Everything from `useForm` plus:
 * - `onSubmit` — a pre-bound handler ready for `<form onSubmit={onSubmit}>`.
 *   Runs Zod validation, the HTTP submission, and the full response pipeline.
 * - `helpers` — a stable object exposing key form methods for use inside
 *   callbacks without closing over the whole form instance.
 *
 * @example
 * ```tsx
 * const loginSchema = z.object({
 *   email:    z.string().email(),
 *   password: z.string().min(8),
 * });
 *
 * function LoginForm() {
 *   const { register, onSubmit, formState: { errors, isSubmitting } } = useForm(
 *     loginSchema,
 *     {
 *       endpoint: '/api/auth/login',
 *       responseHandlers: [
 *         whenStatusCode(422, (res, { setError }) => applyLaravelErrors(res.data, setError)),
 *         whenSuccess((res) => { toast.success('Welcome!'); router.push('/dashboard'); }),
 *         whenError((res)  => toast.error(res.data?.message ?? 'Login failed')),
 *       ],
 *     },
 *   );
 *
 *   return (
 *     <form onSubmit={onSubmit}>
 *       <input {...register('email')}    />
 *       <input {...register('password')} type="password" />
 *       <button type="submit" disabled={isSubmitting}>Log in</button>
 *     </form>
 *   );
 * }
 * ```
 */
export function useForm<S extends ZodTypeAny>(
  schema: S,
  options: UseFormOptions<z.infer<S>> = {},
) {
  type TForm = z.infer<S>;

  const form = useRHForm<TForm>({
    resolver: zodResolver(schema),
    defaultValues: options.defaultValues as DefaultValues<TForm>,
  });

  // react-hook-form guarantees its methods are stable across renders, so this
  // memo effectively never re-runs. Wrapping it prevents a new object identity
  // on every render, which would break useEffect dependency arrays in consumers.
  const helpers: FormHelpers<TForm> = useMemo(
    () => ({
      setValue:    form.setValue,
      setError:    form.setError,
      reset:       form.reset,
      getValues:   form.getValues,
      watch:       form.watch,
      trigger:     form.trigger,
      clearErrors: form.clearErrors,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  /** Internal async function passed to react-hook-form's `handleSubmit`. */
  const executeSubmit = async (rawData: TForm): Promise<void> => {
    const payload = options.transform ? options.transform(rawData) : rawData;

    options.onBeforeSubmit?.();

    let response: ResponseLike<unknown>;

    try {
      if (options.submit) {
        // Custom submission path — bypass oku entirely.
        response = await options.submit(payload);
      } else if (options.method === 'GET') {
        // oku's `get` function does not accept a request body.
        response = await okuGet({
          url: options.endpoint ?? '',
          ...(options.requestOptions as Record<string, unknown>),
        });
      } else {
        // Default: oku post (covers POST / PUT / PATCH / DELETE).
        response = await okuPost({
          url:    options.endpoint ?? '',
          data:   payload as Record<string, unknown>,
          method: (options.method ?? 'POST') as 'POST' | 'PUT' | 'PATCH' | 'DELETE',
          ...(options.requestOptions as Record<string, unknown>),
        });
      }
    } catch (err) {
      // oku rejects with a ResponseObject on non-2xx HTTP responses, and with a
      // plain Error on network failure. Normalise both so the pipeline can
      // treat them uniformly when possible.
      const maybeResponse = err as ResponseLike<unknown>;

      if (
        maybeResponse !== null &&
        typeof maybeResponse === 'object' &&
        'status' in maybeResponse &&
        'statusCode' in maybeResponse
      ) {
        // Looks like a ResponseObject — feed it through the pipeline.
        // onAfterSubmit is called below, after the try/catch, for this path.
        response = maybeResponse;
      } else {
        // True exception (network down, timeout, etc.) — delegate directly.
        // onAfterSubmit is called here before returning because this path
        // exits early and never reaches the call below.
        options.onAfterSubmit?.();
        await options.onError?.(err, helpers);
        return;
      }
    }

    options.onAfterSubmit?.();

    // Response handler pipeline — first match wins.
    if (options.responseHandlers?.length) {
      for (const handler of options.responseHandlers) {
        if (handler.detect(response)) {
          await handler.handle(response, helpers);
          return;
        }
      }
    }

    // Default fallback.
    if (response.status === 'success') {
      await options.onSuccess?.(response, helpers);
    } else {
      await options.onError?.(response, helpers);
    }
  };

  return {
    ...form,
    /**
     * Pre-bound submit handler. Attach directly to `<form onSubmit={onSubmit}>`.
     *
     * Runs Zod validation first; if validation fails the handler returns early
     * and `formState.errors` is populated. On success the validated data flows
     * through `transform` → HTTP call → `responseHandlers` → `onSuccess` /
     * `onError`.
     *
     * react-hook-form's `formState.isSubmitting` is `true` for the entire
     * async duration of this handler.
     */
    onSubmit: form.handleSubmit(executeSubmit as SubmitHandler<TForm>),
    /**
     * A stable reference to key form helper methods. Pass this object into
     * `responseHandlers`, `onSuccess`, or `onError` callbacks — or destructure
     * it when you need fine-grained control without closing over the full form.
     */
    helpers,
  };
}
