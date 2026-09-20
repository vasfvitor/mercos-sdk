// Access to any route, typed by the generated `paths` when the path is a documented one. A path
// typed as a plain `string` skips the types, which is the way around a wrong schema.
import { MercosError } from "./errors.ts";
import type { paths } from "./generated/mercos.ts";
import type { CallOptions, Http, MercosResponse, Query, RequestOptions } from "./http.ts";
import { type ListOptions, paginate } from "./paginate.ts";
import { type CrudResource, crud, type ListWithFilters, tryPost } from "./resources/base.ts";

export type KnownPath = keyof paths;
/** `string & {}` keeps editor completion of the known paths, which a bare `string` would erase. */
export type PathArg = KnownPath | (string & {});

type Verb = "get" | "post" | "put" | "delete";
type Json<T> = T extends { content: { "application/json": infer Body } } ? Body : unknown;

type OperationOf<P extends KnownPath, M extends string> =
  Lowercase<M> extends keyof paths[P] ? paths[P][Lowercase<M>] : never;

export type MethodOf<P> = P extends KnownPath
  ? { [V in Verb]: [paths[P][V]] extends [undefined] ? never : Uppercase<V> }[Verb]
  : string;

type DataOf<Op> = Op extends { responses: infer R }
  ? R extends { 200: infer Ok }
    ? Json<Ok>
    : R extends { 201: infer Created }
      ? Json<Created>
      : unknown
  : unknown;

type BodyOf<Op> = Op extends { requestBody?: infer B } ? ([NonNullable<B>] extends [never] ? never : Json<B>) : never;

type QueryOf<Op> = Op extends { parameters: { query?: infer Q } } ? NonNullable<Q> : never;

type ParamNames<P> = P extends `${string}{${infer Name}}${infer Rest}` ? Name | ParamNames<Rest> : never;
type ParamValues = Record<string, string | number>;
type ParamsOption<P> = [ParamNames<P>] extends [never]
  ? { params?: never }
  : { params: Record<ParamNames<P>, string | number> };

/** The options argument is required only when one of its properties is. */
type OptionsArg<T> = Record<string, never> extends T ? [options?: T] : [options: T];

interface LooseRequestOptions extends Omit<RequestOptions, "readById"> {
  params?: ParamValues;
}

type TypedRequestOptions<P extends KnownPath, Op> = CallOptions &
  ParamsOption<P> & {
    query?: [QueryOf<Op>] extends [never] ? never : Partial<QueryOf<Op>>;
    body?: BodyOf<Op>;
  };

export type RequestOptionsOf<P, M extends string> = P extends KnownPath
  ? TypedRequestOptions<P, OperationOf<P, M>>
  : LooseRequestOptions;

export type ResponseOf<P, M extends string> = MercosResponse<P extends KnownPath ? DataOf<OperationOf<P, M>> : unknown>;

export type ItemOf<P> = P extends KnownPath
  ? DataOf<OperationOf<P, "get">> extends readonly (infer Item extends object)[]
    ? Item
    : never
  : Record<string, unknown>;

/** `alterado_apos` is left out because `changedAfter` owns it. */
type ListQuery<P extends KnownPath> = Omit<QueryOf<OperationOf<P, "get">>, "alterado_apos">;

export type FiltersOf<P> = P extends KnownPath
  ? keyof ListQuery<P> extends never
    ? never
    : Extract<Partial<ListQuery<P>>, Query>
  : Query;

export type ListOptionsOf<P> = ListWithFilters<FiltersOf<P>> &
  (P extends KnownPath ? ParamsOption<P> : { params?: ParamValues });

/** The by-ID sibling, whatever its parameter is called: `{id}`, `{tag_id}`, `{motivo_id}`. */
type ByIdPath<P extends string> = Extract<KnownPath, `${P}/{${string}}`>;

/** A route with no documented body still takes one: the specification may be the one that's wrong. */
type OrUnknown<Body> = [Body] extends [never] ? unknown : Body;

export type InputOf<P> = P extends KnownPath ? OrUnknown<BodyOf<OperationOf<P, "post">>> : unknown;

export type UpdateOf<P> = P extends KnownPath
  ? [ByIdPath<P>] extends [never]
    ? unknown
    : OrUnknown<BodyOf<OperationOf<ByIdPath<P>, "put">>>
  : unknown;

type Flat<P> = P extends `${string}{${string}` ? never : P;

export interface GenericCreated<Data> {
  /** Absent on routes that create no single record, such as the batch and the link routes. */
  id: number | undefined;
  data: Data;
}

/** Like a named resource, except that `create` doesn't demand an ID from the response. */
export type ResourceOf<P> = Omit<CrudResource<ItemOf<P>, InputOf<P>, UpdateOf<P>, FiltersOf<P>>, "create"> & {
  create(
    body: InputOf<P>,
    options?: CallOptions,
  ): Promise<GenericCreated<P extends KnownPath ? DataOf<OperationOf<P, "post">> : unknown>>;
};

export interface GenericAccess {
  /** Any route, through the same queue, retries, and errors as the named resources. */
  request<P extends PathArg, M extends MethodOf<P>>(
    method: M,
    path: P,
    ...rest: OptionsArg<RequestOptionsOf<P, M>>
  ): Promise<ResponseOf<P, M>>;
  /** Walks any path whose GET returns a list, with the same pagination as the named resources. */
  list<P extends PathArg>(path: P, ...rest: OptionsArg<ListOptionsOf<P>>): AsyncGenerator<ItemOf<P>>;
  /** The methods of a named resource, for a path with no parameters. */
  resource<P extends PathArg>(path: P & Flat<P>): ResourceOf<P>;
}

function fillPath(path: string, params: ParamValues = {}): string {
  return path.replace(/\{([^}]+)\}/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined || value === "")
      throw new MercosError("config", `Missing path parameter "${name}" for ${path}.`);
    return encodeURIComponent(String(value));
  });
}

export function generic(http: Http): GenericAccess {
  const access = {
    async request(method: string, path: string, options: LooseRequestOptions = {}) {
      const { params, ...rest } = options;
      const filled = fillPath(path, params);
      // The production block on reads by ID applies here too, so the error keeps its hint.
      const readById = method.toUpperCase() === "GET" && /\/\d+$/.test(filled);
      return await http.request<unknown>(method, filled, { ...rest, readById });
    },
    async *list(path: string, options: ListOptions & { params?: ParamValues; filters?: Query } = {}) {
      const { params, ...rest } = options;
      yield* paginate<Record<string, unknown>>(http, fillPath(path, params), rest);
    },
    resource: (path: string) => ({
      ...crud<Record<string, unknown>, unknown, unknown, Query>(http, path),
      async create(body: unknown, options?: CallOptions) {
        const { id, data } = await tryPost<unknown>(http, path, body, options);
        return { id, data };
      },
    }),
  };
  return access as unknown as GenericAccess;
}
