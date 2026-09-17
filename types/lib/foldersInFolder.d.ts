declare function _default({ path, }: {
    path: any;
}): Promise<{
    path: string;
    stat: fs.Stats;
    name: string;
}[]>;
export default _default;
import fs from 'fs';
