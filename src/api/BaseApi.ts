import type { AxiosRequestConfig } from 'axios';
import api from './v1/axiosInstance';

export interface IRequestConfig<TData = unknown> {
    url: string;
    params?: Record<string, string | number | boolean>;
    data?: TData;
    config?: AxiosRequestConfig;
}

export class BaseApi {
    protected api = api;

    protected get = async <TRes>(req: IRequestConfig): Promise<TRes> => {
        const response = await this.api.get<TRes>(req.url, {
            params: req.params,
            ...req.config,
        });
        return response.data;
    };

    protected post = async <TReq, TRes>(req: IRequestConfig<TReq>): Promise<TRes> => {
        const response = await this.api.post<TRes>(req.url, req.data, {
            params: req.params,
            ...req.config,
        });
        return response.data;
    };

    protected put = async <TReq, TRes>(req: IRequestConfig<TReq>): Promise<TRes> => {
        const response = await this.api.put<TRes>(req.url, req.data, {
            params: req.params,
            ...req.config,
        });
        return response.data;
    };

    protected patch = async <TReq, TRes>(req: IRequestConfig<TReq>): Promise<TRes> => {
        const response = await this.api.patch<TRes>(req.url, req.data, {
            params: req.params,
            ...req.config,
        });
        return response.data;
    };

    protected delete = async <TRes = void>(req: IRequestConfig): Promise<TRes> => {
        const response = await this.api.delete<TRes>(req.url, {
            params: req.params,
            ...req.config,
        });
        return response.data;
    };
}
