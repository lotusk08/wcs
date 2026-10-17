const readFileAsync = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.addEventListener('load', (event) => {
      resolve(event.target.result);
    });
    reader.addEventListener('error', reject);
    reader.readAsText(file);
  });

export default readFileAsync;
