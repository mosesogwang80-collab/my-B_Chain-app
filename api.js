export async function apiFetch(url, options = {}) {
    const { silent, ...fetchOptions } = options;
    const defaultOptions = { credentials: 'include', ...fetchOptions };
    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
        defaultOptions.headers = { 'Content-Type': 'application/json', ...options.headers };
        defaultOptions.body = JSON.stringify(options.body);
    }
    try {
        const response = await fetch(url, defaultOptions);
        const data = await response.json();
        if (!response.ok) throw new Error(data.message || 'Server error');
        return data;
    } catch (error) {
        if (window.showToast && !silent) {
            window.showToast(error.message, "error");
        }
        console.error("API Fetch Error:", error);
        throw error;
    }
}