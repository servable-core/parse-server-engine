declare namespace _default {
    namespace docker {
        function path(): string;
    }
    function adaptAppPayload({ item, config, servableConfig, schema }: {
        item: any;
        config: any;
        servableConfig: any;
        schema: any;
    }): Promise<{
        filesAdapterEndPoint?: undefined;
        databaseURI?: undefined;
    } | {
        filesAdapterEndPoint: any;
        databaseURI: any;
    }>;
}
export default _default;
