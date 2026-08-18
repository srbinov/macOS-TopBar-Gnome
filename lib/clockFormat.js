const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** @param {Date} date */
export function formatMacDate(date) {
    return `${DAY_NAMES[date.getDay()]} ${MONTH_NAMES[date.getMonth()]} ${date.getDate()}`;
}

/**
 * @param {Date} date
 * @param {{use24Hour?: boolean, showSeconds?: boolean}} [options]
 */
export function formatMacTime(date, options = {}) {
    const {use24Hour = false, showSeconds = false} = options;
    const rawHours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = showSeconds ? `:${String(date.getSeconds()).padStart(2, '0')}` : '';

    if (use24Hour) {
        const hours = String(rawHours).padStart(2, '0');
        return `${hours}:${minutes}${seconds}`;
    }

    const hours = rawHours % 12 === 0 ? 12 : rawHours % 12;
    const period = rawHours < 12 ? 'AM' : 'PM';
    return `${hours}:${minutes}${seconds} ${period}`;
}
