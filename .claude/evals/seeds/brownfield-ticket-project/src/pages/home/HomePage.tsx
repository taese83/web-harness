import {formatDate} from '../../shared/lib/formatDate'

export const HomePage = () => <main><h1>홈</h1><p>{formatDate(new Date())}</p></main>
