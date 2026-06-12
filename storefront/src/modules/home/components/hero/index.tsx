import { Button } from "@medusajs/ui"

const Hero = () => {
  return (
    <div className="min-h-screen w-full relative bg-brand-cream overflow-hidden">
      <div className="absolute inset-0 z-10 flex flex-col justify-center items-center text-center px-4 md:px-8">
        <h1 className="text-[15vw] md:text-[8rem] font-bold tracking-tighter text-brand-blue leading-[0.85] uppercase">
          Welcome to
        </h1>
        <h1 className="text-[15vw] md:text-[8rem] font-bold tracking-tighter text-brand-green leading-[0.85] uppercase">
          Holisto
        </h1>
        <p className="mt-8 text-2xl md:text-4xl text-brand-brown font-medium max-w-2xl text-center">
          The future of high-end audio and smart home gadgets.
        </p>
        
        <div className="mt-12 flex flex-col sm:flex-row gap-4">
          <a href="#featured">
            <button className="px-10 py-5 bg-brand-blue hover:bg-brand-yellow text-brand-cream hover:text-brand-brown rounded-full text-2xl md:text-3xl font-bold transition-colors duration-300 shadow-[0_4px_20px_rgba(0,25,118,0.3)] hover:shadow-none hover:translate-y-1">
              Shop Now
            </button>
          </a>
        </div>
      </div>

      {/* Playful shapes / Decorators */}
      <div className="absolute left-[-10vw] top-[10vh] w-[40vw] h-[40vw] bg-brand-yellow rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-pulse"></div>
      <div className="absolute right-[-5vw] top-[40vh] w-[30vw] h-[30vw] bg-brand-green rounded-full mix-blend-multiply filter blur-3xl opacity-50 animate-pulse delay-75"></div>
      
      {/* Wave divider at the bottom */}
      <div className="absolute bottom-0 w-full overflow-hidden leading-[0]">
        <svg viewBox="0 0 1200 120" preserveAspectRatio="none" className="relative block w-full h-[150px] md:h-[250px]">
          <path d="M321.39,56.44c58-10.79,114.16-30.13,172-41.86,82.39-16.72,168.19-17.73,250.45-.39C823.78,31,906.67,72,985.66,92.83c70.05,18.48,146.53,26.09,214.34,3V120H0V95.8C59.71,118,152.47,143.22,227.14,118.3,258.04,107.95,290.82,86.2,321.39,56.44Z" fill="#ffbf00"></path>
        </svg>
      </div>
    </div>
  )
}

export default Hero

